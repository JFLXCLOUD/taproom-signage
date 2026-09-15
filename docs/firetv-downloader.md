# Install through Downloader on Fire TV

## Permanent APK address

Use this address when creating a Downloader short code:

```text
https://github.com/JFLXCLOUD/taproom-signage/releases/latest/download/TaproomSignage-firetv.apk
```

It downloads the APK from the GitHub release marked **Latest**. The address stays
the same as versions change, so a short code pointing here can be reused for
future releases. Do not shorten a version-specific `/download/v1.1.0/` URL or
the temporary `release-assets.githubusercontent.com` address after redirecting.

This uses [GitHub's documented latest-asset URL](https://docs.github.com/en/repositories/releasing-projects-on-github/linking-to-releases).
Each release keeps the asset name `TaproomSignage-firetv.apk`, marks the release
Latest, and verifies that this permanent address downloads the same APK that was
built for that release.

## Get a Downloader code

1. Open [the official AFTVnews URL shortener](https://go.aftvnews.com/) on your
   phone or computer.
2. Paste the permanent APK address above.
3. Complete the CAPTCHA and select **Shorten**.
4. In **Downloader** on the Fire TV, enter the resulting numeric code and select
   **Go**. Follow Downloader's download and Android installation prompts.

Keep the numeric code for future installs. AFTVnews cannot change a code's
destination after creation, which is why the permanent URL matters. The service
also reserves the right to recycle long-unused codes; see its [FAQ](https://go.aftvnews.com/p/faq/).

The code downloads the current APK when used; it does not automatically update
an installed app. Current APKs use debug signing, so an older installation may
need to be uninstalled before installing a new APK if Android reports a signature
mismatch. Uninstalling requires pairing the TV again. Most menu/UI updates are
served by the Windows server and do not require reinstalling the Fire TV app.
