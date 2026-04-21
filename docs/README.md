# Documentation (`docs/`)

All project documentation that lives outside the root [README.md](../README.md) is organized here.

---

## Start here

| Document | Purpose |
|----------|---------|
| [architecture.md](architecture.md) | **Platform architecture** — Mermaid view + link to canonical PlantUML deployment diagram |
| [platform-functionality-inventory.md](platform-functionality-inventory.md) | Capability inventory mapped to code areas |

---

## Diagrams by type (`docs/diagrams/`)

| Folder | Contents |
|--------|----------|
| [diagrams/architecture/](diagrams/architecture/) | System / deployment style diagrams (**[platform-architecture.puml](diagrams/architecture/platform-architecture.puml)**) |
| [diagrams/sequence/](diagrams/sequence/) | PlantUML **sequence** diagrams (`seq-01` … `seq-41`) + [README index](diagrams/sequence/README.md) |
| [diagrams/use-case/](diagrams/use-case/) | Global **use case** narrative + [global-use-case-diagram.puml](diagrams/use-case/global-use-case-diagram.puml) |
| [diagrams/class/](diagrams/class/) | **Class** / domain model narrative + [global-class-diagram.puml](diagrams/class/global-class-diagram.puml) |

See **[diagrams/README.md](diagrams/README.md)** for a short index of diagram sources.

---

## Layout

```
docs/
├── README.md                          ← this hub
├── architecture.md                    ← architecture narrative + Mermaid
├── platform-functionality-inventory.md
└── diagrams/
    ├── README.md
    ├── architecture/
    │   └── platform-architecture.puml
    ├── sequence/
    │   ├── README.md
    │   ├── seq-01-login.puml
    │   └── …
    ├── use-case/
    │   ├── global-use-case.md
    │   └── global-use-case-diagram.puml
    └── class/
        ├── global-class.md
        └── global-class-diagram.puml
```

---

## Rendering PlantUML

Use the [PlantUML](https://plantuml.com/) CLI, Docker image `plantuml/plantuml`, or an IDE extension. Examples from repository root:

```bash
java -jar plantuml.jar docs/diagrams/architecture/*.puml
java -jar plantuml.jar docs/diagrams/sequence/*.puml
java -jar plantuml.jar docs/diagrams/use-case/*.puml
java -jar plantuml.jar docs/diagrams/class/*.puml
```
