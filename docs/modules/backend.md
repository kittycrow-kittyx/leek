# Backend selection

`build` receives the selected target, staged project and output directory and verifies the backend and its Bake checkout. Analysis and lowering requests use Bake directly. C and Rust emission use their respective compiler APIs after successful Bake lowering. The WASM path invokes the pinned Baguette entry point; Baguette performs its own Bake stage exactly once. Its existing numeric ABI restrictions remain in effect until Leek implements the complete OS boundary. The configuration does not claim complete-kernel verification before that boundary exists.
