# Modular WAT linking

`linkWat(layoutPath)` consumes the pinned Baguette `WatLayout` contract and returns the reconstructed WAT text. It checks schema and encoding, module paths, exact field counts, contiguous UTF-16 offsets and complete consumption of declarations. Baguette's empty-module comment is accepted for modules with no standalone fields. Real paths must remain within the layout directory.

This is the separate assembly step used by the downstream Teto-style build. Baguette remains responsible for producing and partitioning WAT. Tests round-trip its modular output, reject altered layouts and require independent Binaryen compilation to reproduce Baguette's reference binary byte for byte.
