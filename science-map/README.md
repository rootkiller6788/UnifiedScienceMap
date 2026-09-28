# science-map
Interactive UCSD map of science visualization.

This repository hosts an **interactive visualization** of the **UCSD Map of Science (2001–2010)**, replicated by the **Science Integrity Alliance** using publicly available resources provided by the original project. The UCSD Map of Science is a comprehensive classification system that visually represents scientific disciplines and their interrelationships based on citation patterns and subject matter.

## Table of Contents

- [About the Project](#about-the-project)
  - [Team](#team)
- [Data](#data)
- [License](#license)
- [Attribution](#attribution)
- [Acknowledgments](#acknowledgments)

## About the Project

The **Science Integrity Alliance** has utilized the resources made available by the **UCSD Map of Science** project to replicate the interactive map of scientific disciplines. This visualization allows users to explore the relationships between various scientific fields over a decade of data from major bibliographic databases.

For more detailed information about the UCSD Map of Science project, please visit the [official project page](https://cns.iu.edu/2012-UCSDMap.html).

### Team

The original UCSD Map of Science project was led by **SciTech Strategies Inc.** in collaboration with the **Cyberinfrastructure for Network Science Center at Indiana University**. The project team includes:

- **Katy Börner**
- **Richard Klavans**
- **Michael Patek**
- **Angela M. Zoss**
- **Joseph R. Biberstine**
- **Robert P. Light**
- **Vincent Larivière**
- **Kevin W. Boyack**

The **Science Integrity Alliance** team responsible for replicating this map includes:

- **Luciana Machado**

## Data

The **2010 UCSD Map of Science and Classification System** encompasses:

- **Web of Science Data:** 10 years (2001–2010)
- **Scopus Data:** 8 years (2001–2008)
- **Subdiscipline Assignments:** Conducted by SciTech Strategies

### Available Data Formats

- **MS AccessDB**
- **MS Excel File:** Identical to the MS AccessDB
- **Data Dictionary and Database Schema**
- **Network `.net` File:** Used to visually render the science map, including discipline nodes and names

**Note:** This repository uses the `.net` file to generate the interactive visualization.

## License

This work is shared under the **Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported (CC BY-NC-SA 3.0)** license. This allows you to:

- **Share** — copy and redistribute the material in any medium or format.
- **Adapt** — remix, transform, and build upon the material.

Under the following terms:

- **Attribution** — You must give appropriate credit, provide a link to the license, and indicate if changes were made.
- **NonCommercial** — You may not use the material for commercial purposes.
- **ShareAlike** — If you remix, transform, or build upon the material, you must distribute your contributions under the same license as the original.

For more details, refer to the [CC BY-NC-SA 3.0 License](https://creativecommons.org/licenses/by-nc-sa/3.0/legalcode).

## Attribution

When using or sharing this work, please include the following acknowledgment:

> "The authors wish to acknowledge The Regents of the University of California, SciTech Strategies, Observatoire des Sciences et des Technologies, and the Cyberinfrastructure for Network Science Center for making the 2010 UCSD Map of Science and Classification System available for this work."

## Acknowledgments

- **Original Classification System and Data:**
  - UCSD Map of Science (2010) classification system by SciTech Strategies, Inc. and collaborators.
  - Data covers 10 years of Web of Science data (2001–2010) and 8 years (2001–2008) of Scopus data.

- **Publication:**
  > Börner, K., Klavans, R., Patek, M., Zoss, A.M., Biberstine, J.R., Light, R., Larivière, V., & Boyack, K.W. (2012). **Design and Update of a Classification System: The UCSD Map of Science.** *PLoS ONE*, 7(7): e39464. [https://doi.org/10.1371/journal.pone.0039464](https://doi.org/10.1371/journal.pone.0039464)

- **Tooling:**
  - Visualization generated with [NetworkX](https://networkx.org/) and [Plotly](https://plotly.com/python/).
