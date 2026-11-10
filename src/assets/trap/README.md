# Trap mechanism artwork

Generated dark-fantasy artwork, optimized as WebP for the UI. Source generation used the approved trap mockup, blackened iron and aged brass, frontal orthographic parts. No text is baked into the textures.

- rim: static outer housing; transparent inside and outside
- plate: texture clipped by exact gameplay wedge paths
- latch-base: fixed bracket
- latch-bolt: single moving part, translated 9 SVG units when released
- needle: rotates around (160, 160), tip aligned to the 124-unit sector radius
- hub: plain center for live progress text
- background: standalone dungeon backdrop

The generated needle and bolt contain peripheral semi-transparent shading. Explicit SVG clip paths in TrapMechanism remove that shading in the rendered game. Keep those contours if exporting/reusing these sprites; the raw WebPs are not standalone cleaned cutouts. The base and bolt share one consistent placement for both states rather than crossfading mismatched generated images.

Gameplay geometry is owned by trapConfig: 80/70/60/50/40/30/20/10 degrees, revolution 3000 ms. Texture and latch state never change hit detection. SVG fills and needle provide a usable fallback if artwork fails to load. Decorative latch/tint transitions honor reduced-motion; the functional needle remains animated.

## Plate finish pass

- pressed-plate: independent dark aged bronze texture for released plates
- seam: narrow straight worn bronze joint decal, centered on each existing sector boundary

Each wedge has its own rotated texture mapping to break continuous disc grain. Marked plates retain their number, become darker, gain clipped inset relief and a small check indicator near the rim. The large opaque green overlay is removed. A 240 ms edge glint honors reduced motion. The seam strip is mapped to 3.4 SVG units in width and hidden beneath the rim/hub at its ends. No stamps or wear patches are placed on the faces of the plates. The needle adds a crisp dark outline and a brighter 1.8-unit shaft without changing its tip or hit angle.

## Mounted locks and plate-relative seams

The active housing is rim-track.webp: a continuous ring with no baked brackets or rivets competing with the eight animated locks. Generated from the old rim using built-in imagegen: preserve aged iron/bronze and orthographic annulus, remove projecting brackets and hardware, keep the mounting band clear and the inside/outside transparent.

Each lock has a dark steel mounting body and recessed travel channel. Its brass tongue retracts 11 units into a clipped housing instead of floating beyond the rim. Closed tongues overlap the plate edge; open tongues clear it. Labels sit at radius 94 and success indicators at 110 to keep them separate and inside the rim.

Joint decals are clipped separately into each adjacent sector. A released plate dims only its own half of the joint (opacity .12 vs .48); a dark continuous gap and clipped bevel preserve the boundary without a bright floating rail over recessed plates. Gameplay angles and timing remain unchanged.
