package com.taproom.signage

import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.SocketTimeoutException
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * Finds the signage server on the local network so nobody types an IP into a TV.
 *
 * Three strategies, cheapest first:
 *   1. The address we used last time, if it still answers.
 *   2. A UDP broadcast handshake (see src/discovery.js) — normally instant.
 *   3. A bounded sweep of the local /24, for networks that drop broadcast.
 *
 * All of it runs off the main thread, and [resolve] calls back on that worker
 * thread - callers must post to the main looper before touching any view.
 */
object Discovery {

    private const val PROBE = "TAPROOM-DISCOVER/1"
    private const val PROTO = "taproom/1"
    private const val DISCOVERY_PORT = 41234

    /** Ports the sweep tries, in order. Matches the documented defaults. */
    private val SCAN_PORTS = intArrayOf(8080, 80, 8099)

    fun interface Callback {
        fun onResult(baseUrl: String?)
    }

    @JvmStatic
    fun resolve(saved: String?, callback: Callback) {
        Thread({
            var result: String? = null
            try {
                if (!saved.isNullOrBlank() && isOurServer(saved)) {
                    result = saved
                } else {
                    result = broadcastProbe() ?: sweepSubnet()
                }
            } catch (t: Throwable) {
                Log.w("discovery failed: ${t.message}")
            }
            callback.onResult(result)
        }, "taproom-discovery").start()
    }

    // ------------------------------------------------------------- strategy 2

    /**
     * Broadcast a probe and take the source address of the first sane reply.
     *
     * The reply deliberately carries only a port: using the packet's source IP
     * means a multi-homed server (the Pi has ethernet, its own access point and
     * Tailscale) never has to guess which of its addresses we can reach.
     */
    private fun broadcastProbe(): String? {
        DatagramSocket().use { socket ->
            socket.broadcast = true
            socket.soTimeout = 400

            val payload = PROBE.toByteArray()
            for (target in broadcastAddresses()) {
                try {
                    socket.send(DatagramPacket(payload, payload.size, target, DISCOVERY_PORT))
                } catch (t: Throwable) {
                    Log.w("probe to $target failed: ${t.message}")
                }
            }

            val buffer = ByteArray(2048)
            val deadline = System.currentTimeMillis() + 2000
            while (System.currentTimeMillis() < deadline) {
                val packet = DatagramPacket(buffer, buffer.size)
                try {
                    socket.receive(packet)
                } catch (e: SocketTimeoutException) {
                    continue
                }
                val url = parseReply(packet) ?: continue
                Log.i("discovered $url by broadcast")
                return url
            }
        }
        return null
    }

    private fun parseReply(packet: DatagramPacket): String? = try {
        val body = JSONObject(String(packet.data, 0, packet.length, Charsets.UTF_8))
        if (body.optString("proto") != PROTO) {
            null
        } else {
            val port = body.optInt("port", 0)
            if (port <= 0) null else "http://${packet.address.hostAddress}:$port"
        }
    } catch (t: Throwable) {
        null
    }

    /** 255.255.255.255 plus each interface's directed broadcast, which some APs prefer. */
    private fun broadcastAddresses(): List<InetAddress> {
        val out = ArrayList<InetAddress>()
        out.add(InetAddress.getByName("255.255.255.255"))
        try {
            for (nif in NetworkInterface.getNetworkInterfaces()) {
                if (!nif.isUp || nif.isLoopback) continue
                for (address in nif.interfaceAddresses) {
                    address.broadcast?.let { out.add(it) }
                }
            }
        } catch (t: Throwable) {
            Log.w("interface enumeration failed: ${t.message}")
        }
        return out
    }

    // ------------------------------------------------------------- strategy 3

    /** Last resort for networks that filter broadcast: probe every host on our /24. */
    private fun sweepSubnet(): String? {
        val local = localIpv4() ?: return null
        val prefix = local.substringBeforeLast('.', "")
        if (prefix.isEmpty()) return null

        Log.i("broadcast found nothing; sweeping $prefix.0/24")
        val pool = Executors.newFixedThreadPool(48)
        val hit = AtomicReference<String?>(null)

        try {
            for (host in 1..254) {
                val candidate = "$prefix.$host"
                if (candidate == local) continue
                pool.execute {
                    if (hit.get() != null) return@execute
                    for (port in SCAN_PORTS) {
                        if (hit.get() != null) return@execute
                        val url = "http://$candidate:$port"
                        if (isOurServer(url, connectMs = 350, readMs = 350)) {
                            hit.compareAndSet(null, url)
                            return@execute
                        }
                    }
                }
            }
            pool.shutdown()
            pool.awaitTermination(25, TimeUnit.SECONDS)
        } catch (t: Throwable) {
            Log.w("sweep failed: ${t.message}")
        } finally {
            pool.shutdownNow()
        }

        hit.get()?.let { Log.i("discovered $it by sweep") }
        return hit.get()
    }

    private fun localIpv4(): String? {
        try {
            for (nif in NetworkInterface.getNetworkInterfaces()) {
                if (!nif.isUp || nif.isLoopback) continue
                for (address in nif.inetAddresses) {
                    if (address is Inet4Address && !address.isLoopbackAddress) {
                        return address.hostAddress
                    }
                }
            }
        } catch (t: Throwable) {
            Log.w("no local address: ${t.message}")
        }
        return null
    }

    // ----------------------------------------------------------------- shared

    /**
     * True only for our own server: the health endpoint identifies the app, so a
     * sweep cannot latch onto some unrelated web server on the network.
     */
    @JvmStatic
    fun isOurServer(baseUrl: String, connectMs: Int = 2500, readMs: Int = 2500): Boolean {
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL("$baseUrl/api/health").openConnection() as HttpURLConnection).apply {
                connectTimeout = connectMs
                readTimeout = readMs
                requestMethod = "GET"
                useCaches = false
            }
            if (conn.responseCode != 200) return false
            val body = JSONObject(readAll(conn))
            body.optString("app") == "taproom-signage"
        } catch (t: Throwable) {
            false
        } finally {
            conn?.disconnect()
        }
    }

    private fun readAll(conn: HttpURLConnection): String {
        conn.inputStream.use { input ->
            val out = ByteArrayOutputStream()
            val buf = ByteArray(4096)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                out.write(buf, 0, n)
                if (out.size() > 64 * 1024) break
            }
            return out.toString("UTF-8")
        }
    }
}
