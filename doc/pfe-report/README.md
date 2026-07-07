# Final-Year Project Report (LaTeX)

ESPRIM-compliant report for the **Knowledge Platform** project.

## Location

All sources: `doc/pfe-report/`

## Diagrams (54 total)

All PlantUML sources under `docs/diagrams/` are exported to `assets/figures/`:

| Category | Count | In report |
|----------|-------|-----------|
| Architecture | 1 | Chapter 3 + Appendix D |
| Use case (global) | 1 | Chapter 2 + Appendix D |
| Use case (sprint-scoped) | 5 | Chapter 3 (\S sprint design) |
| Class model (global) | 1 | Chapter 3 + Appendix D |
| Class model (sprint-scoped) | 5 | Chapter 3 (\S sprint design) |
| Sequence flows | 41 | Chapter 3 by sprint (+ index in Appendix D) |

Regenerate all PNGs from repository root:

```bash
java -jar scripts/plantuml.jar -tpng -o doc/pfe-report/assets/figures docs/diagrams/architecture/*.puml docs/diagrams/use-case/*.puml docs/diagrams/class/*.puml docs/diagrams/sequence/*.puml
```

## Before compiling

1. Edit `config.tex` with your real name, company, supervisors, jury, defense date.
2. Ensure `assets/logo-esprim.png` exists.

## Build PDF

**Overleaf (recommended):** upload `doc/pfe-report/` folder.

**Local (MiKTeX):**

```bash
cd doc/pfe-report
pdflatex main.tex
bibtex main
pdflatex main.tex
pdflatex main.tex
```

## Structure

- Chapters 1--5: narrative report
- **Appendix D:** complete diagram catalog (all 44 figures)
- Guide boxes disabled (`\showguidefalse`)
