# Random-domain path replay — work in progress

## Why source support matters

A reservoir weighted only by its previous radiance cannot choose a previously dark path, even if that
path would be bright after an occluder moves. Reusing it as if it covered all current paths can therefore
darken disocclusions. `PathDomainSupportAudit.cpp` **exhaustively enumerates a finite toy domain**: two
previous draws, one current draw and both weighted selections. With visibility inverted between two equal
samples, the exact current mean is `0.5`; zero-floor reuse gives `0.1666667`, while a strictly positive
importance floor recovers `0.5`. For an entirely dark source becoming bright, the corresponding values are
`1`, `0.3333333` and `1`.

The contemplated alternative stores a random-number seed rather than only the resulting path vertex. At a
new receiver or scene, the same seed is fully retraced, and the new contribution is evaluated there. Its
importance target is `luminance + positive_floor`, so every random sequence has nonzero selection support,
including paths that were previously dark. For a reservoir of `M` draws with weight sum `S` and selected
source target `p`, its aggregate multiplier is `S / (M p)`. Re-evaluating the selected seed with target
`p'` gives a merge weight `p' * multiplier * M`. This is an identity mapping in the random-number domain,
not geometric endpoint reconnection; no geometric reconnection Jacobian is used. It can cost substantially
more because every reused seed must be retraced in the current scene.

The finite enumeration assumes uniform independent input draws, independent weighted selections, fixed
counts and a positive target. It is **not** proof of random-generator independence, unbiasedness under all
adaptive reuse, a Vulkan implementation, an efficient renderer, or full ReSTIR GI. GPU tests, dynamic
occluders, multibounce transport, material coverage, production integration and multiple actual renders
remain to be implemented and verified.

```bash
bash Exhibits/LightCompute/RunPathDomainSupportAudit.sh
SANITIZE=1 bash Exhibits/LightCompute/RunPathDomainSupportAudit.sh
```

[Release output](Results/PathDomainSupport-release.txt) · [sanitized output](Results/PathDomainSupport-sanitized.txt)
