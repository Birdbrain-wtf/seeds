# spec

The protocol, in two papers. Both describe the same rules as the code in [`chain/`](../chain) and the vectors in [`conformance/`](../conformance), and change with them.

| Paper | Source | What it is |
| --- | --- | --- |
| **Seeds: A Store of Values** | [`seeds-intro.tex`](seeds-intro.tex) → [`seeds-intro.pdf`](seeds-intro.pdf) | The white paper. The problem, the idea, how joining and contributing work, where new units appear, the test run and the limits. |
| **Seeds: A Chain with One Job** | [`seeds.tex`](seeds.tex) → [`seeds.pdf`](seeds.pdf) | The specification. The rules as definitions, invariants and algorithms, what a profile may set and may never add, the security arithmetic and the open questions. |

Each tagged edition is also published at [Birdbrain-wtf/publications](https://github.com/Birdbrain-wtf/publications) (edition 3.0.0, CC-BY-4.0). The papers are licensed CC-BY-4.0; the code in the rest of this repository is Apache-2.0.

## Build

With TeX Live (LuaLaTeX and BibTeX):

```
lualatex seeds-intro.tex && bibtex seeds-intro && lualatex seeds-intro.tex && lualatex seeds-intro.tex
lualatex seeds.tex && bibtex seeds && lualatex seeds.tex && lualatex seeds.tex
```

`seeds.bib` holds only what the papers cite. The look is `seeds-academic.sty`.
