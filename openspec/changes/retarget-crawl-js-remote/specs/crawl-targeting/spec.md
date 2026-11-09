# Spec Delta

## Purpose

Saved-search-driven crawl targeting and target-profile eligibility, so discovery queries fetch the operator's actual target (JS stack, remote-only, middle/semi-senior) instead of broad terms that waste downstream LLM filtering.

## ADDED Requirements

### Requirement: Crawl queries follow the saved search target

Discovery SHALL query exactly the saved search's `searchTerms`, `cityLocations`, and `sources`, so retargeting the preset retargets the next scheduled run without a deploy.

#### Scenario: Retargeted terms drive the crawl

- **WHEN** the `Tijuana DEV` preset holds `searchTerms` of `React`, `React Native`, `Node.js`, `NestJS`, `Express` and `cityLocations` of `tijuana, rosarito, ensenada, mexicali, tecate, la paz`
- **THEN** the next scheduled run crawls those terms and cities, and no longer queries removed terms (`Python`, `Go`, `Golang`) or removed sources (`golangjobs`)

### Requirement: Remote is a must

Any job that is not remote SHALL be off-target, regardless of city — including on-site or hybrid roles in Baja cities. Remote roles are never discarded for location reasons.

#### Scenario: On-site role in a listed city

- **WHEN** a posting is on-site in Tijuana (or any listed city) and is otherwise a match
- **THEN** it is verdict off-target with a remote-must reason and never reaches scoring

#### Scenario: Remote role from any company location

- **WHEN** a posting is 100% remote for a company anywhere
- **THEN** location alone never makes it off-target

### Requirement: Seniority band decides target verdicts

Target verdicts SHALL admit middle / mid-level / semi-senior (including US-board phrasing `Mid-level` / `Mid`) and plain hands-on Senior roles, and SHALL reject Junior / Entry-level / Intern / Trainee / Graduate roles and Tech Lead, Staff, Principal, Manager roles.

#### Scenario: Middle engineer posting

- **WHEN** a software posting is titled Middle / Mid-level / Semi-senior Engineer (or equivalent) in the JS stack
- **THEN** it passes the target filter when no other exclusion applies

#### Scenario: Junior posting

- **WHEN** a posting title indicates junior / entry-level / intern / trainee / graduate
- **THEN** it is marked `skipped` as off-target without spending an LLM classification call (inverting the previous auto-pass exception)

#### Scenario: Tech lead posting

- **WHEN** a posting is for a Tech Lead (or Staff / Principal / engineering-manager role)
- **THEN** it is off-target even when the stack matches

### Requirement: Stack scope follows the known-stack list

Postings centered on stacks outside `React`, `React Native`, `Node.js`, `NestJS`, `Express` (notably Python-centered data roles and Go-centered infra roles) SHALL be off-target unless the role itself is JS-stack work that merely mentions them.

#### Scenario: Python data role

- **WHEN** a posting is a Data Analyst / Data Scientist / ML role mentioning Python
- **THEN** it is off-target without reaching scoring
