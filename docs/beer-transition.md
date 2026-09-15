# Textured beer transition

The menu-to-poster transition uses an original generated photographic beer material
with a Canvas 2D surface animation. Traveling waves run up the left and right walls;
foam follows the surface, carbonation rises, and small splash droplets and wet beads
briefly remain above the liquid. It is simulated motion, not filmed beer or a fluid
physics solver. No Shutterstock footage is bundled. The supplied Shutterstock page
blocked inspection, so this is based on the user's description rather than a verified
match of the reference video.

The realism refinement keeps the original photographic asset and adds continuous
two-dimensional texture distortion, shaded bubble highlights, a wet surface rim,
foam that gathers at the walls, and droplets with gravity-based trajectories from
their launch point. Residual beads slide down the glass and leave short wet trails.
Two lightweight displacement passes warp the liquid in both directions. Foam
segments are sheared along their shared edges to avoid a stepped strip appearance.

The glass fills for 2.6 seconds, stays covered during the content swap, then drains.
The entire effect lasts about 6 seconds. The poster's display duration begins afterward.
Reduced-motion settings skip automatic TV transitions. A user clicking Preview or
Play again explicitly requests the animation, so those controls play the effect even
when Windows animation effects are off or browser reduced motion is enabled.
Missing textures use an opaque gradient;
an unavailable canvas reveals the poster immediately. Rendering is capped around
0.6 megapixels and 30 frames per second. Physical Fire TV performance remains to be tested.

Validation: `scripts/verify-beer.mjs` exercises the real menu/poster rotation, full
pixel opacity at the swap, portrait rotations, cancellation, reduced motion, and the
preview dialog on mobile and desktop. Set `PLAYWRIGHT_MODULE` to the installed module.

## Asset provenance

- Method: built-in image generation tool, using the imagegen skill.
- Project asset: `public/display/assets/beer-macro.png` (1536 x 1024).
- Original retained under the Codex generated_images directory.
- No reference image or third-party footage was used as input.

### Final generation prompt

Use case: photorealistic-natural. Asset type: original photographic texture for an animated beer filling a TV screen. Create ONE wide 1536x1024 macro photographic image looking straight through flat clear glass completely filled with golden lager. Entire frame is beer, edge to edge, NO glass outline, NO glass rim, NO background, NO text, no logos. Lower 80 percent: rich translucent amber-gold beer, fine dense rising carbonation, realistic refraction and cloudy turbulence, softly backlit warm center with darker copper edges. Upper 20 percent: dense creamy off-white beer head consisting of incredibly detailed irregular microbubbles, wet foam pores, softly sculpted larger foam clusters, a slightly irregular roughly horizontal foam-to-liquid boundary at 20 percent of the height. The foam continues right to the TOP edge. Premium macro beverage photography, natural material detail, very sharp microtexture, physically plausible organic liquid, not illustration or vector or smooth CGI. This is a flat rectangular material texture to be sampled by a canvas renderer. Do not depict a complete drinking glass or any scene outside the liquid.
