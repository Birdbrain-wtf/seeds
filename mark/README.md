# Seed mark

A fixed picture of one Seed's identity. You can read the exact bytes back from it and look them up.

The Identity Forest draws each Seed as an organism. The organism is a portrait. It grows as the person takes part, so it cannot identify them. The mark does not change. It carries 32 bytes and a 16-bit check, and nothing else.

## Two kinds

| Kind | The 32 bytes | What it proves |
| --- | --- | --- |
| **anchored** | The member's account, the public key the chain's `Members` map is keyed by | That this record exists on chain, once you look it up |
| **unanchored** | `blake2b-256("seed-mark/v1/unanchored:" + profile + ":" + slug)` | Nothing. A stable placeholder for a Seed that has no account yet |

An unanchored mark is drawn in grey with a hollow, dashed core, so it never passes for an anchored one. Its rings and frame stay solid so a camera can still read it and report that it proves nothing. The kind is also part of the check bits, so a reader recovers it from the picture, not from the styling. When a Seed gets an account, its mark changes once, from hollow to solid, and then stays fixed.

## Geometry (v1)

The viewBox is `0 -2 120 122` and the centre is (60, 60). Angles run clockwise from the top.

- **Frame**: a circle of radius 53, with a stem and a dot above it at 0°. The stem fixes which way is up.
- **Data**: four rings, each 64 sectors of 5.625°. Ring *r* spans radius 16 + 7*r* to 21 + 7*r*. Ring *r*, sector *s* is bit `7 - (s mod 8)` of byte `8r + floor(s / 8)`, most significant bit first. A set bit is drawn and a clear bit is left empty. Neighbouring set sectors join into one arc.
- **Check**: one ring of 16 sectors, radius 45 to 49. It holds the first two bytes of `blake2b-256("seed-mark/v1/" + kind ‖ payload)`, most significant bit first from 0°.
- **Core**: a circle whose edge is ink at radius 8.8 to 10. Anchored marks fill it with one colour inside a solid ink edge, so a camera finds the edge whatever the colour. Unanchored marks draw only a dashed edge.

A reader takes each arc's outer start and end angles and outer radius, sets the bits it covers, then tries both kinds against the check. If neither matches, the picture is misread or is not a seed mark. It reports that and does not guess.

## Use

```bash
bun run mark.ts draw anchored 0x<32-byte account>      # SVG on stdout
bun run mark.ts draw unanchored chaos-sessions <slug>
bun run mark.ts read mark.svg                          # {"kind","payload"}
bun run verify.ts mark.svg ws://127.0.0.1:9984         # look the record up on a seeds chain
bun run test.ts                                        # round-trips, tamper, SS58, frozen vectors
```

`verify.ts` exits 0 only for an anchored mark whose account is a member. It prints the member's index, community, admission block, and evidence and witnesses. It exits 1 if the account is not a member and 2 if the mark is unanchored.

`vectors.json` freezes the bytes and check bits for four inputs. Any implementation in another language has to reproduce them.

## Reading a picture

`read-image.ts` reads a mark from raw pixels, so the same code runs on a computer and in a browser. It finds ring-shaped shapes and fits an ellipse to each. The frame and the core are two circles with the same centre. From their two ellipses it works out exactly where the centre is and how the picture is tilted, and undoes the tilt. The stem says which way is up. It then lines every cell up and reads it. It also handles a mark shown light on dark, a mirror image, and uneven light. It flips at most one faint cell to make the check match, and says so when it does. It never guesses beyond that.

```bash
bun run read-photo.ts photo.jpg      # {"found","kind","payload",…}, using ImageMagick to open the file
bun run photo-test.ts 12             # marks on busy backgrounds, rotated, tilted, blurred, noisy, small, dark, mirrored
bun run build-scan.ts                # out/scan.html: the phone scanner, one self-contained page
```

The scanner page uses the phone's camera, or a photo you choose. Nothing leaves the device: the reader runs in the page and makes no network calls. For an anchored mark it shows the account. Looking the record up still needs a node (`verify.ts`).

The last photo test read 144 of 144 pictures correctly, with no cells flipped. It covered marks on a busy background that were rotated, tilted steeply, blurred with noise and JPEG artefacts, lit unevenly, 150 pixels across, light on a dark screen, and mirrored. In the same run, pictures with no mark in them read as nothing. These are generated pictures, not photographs from a phone.
