# Solution for Issue #229

## 🛠️ Proposed Solution (by Aditya Waghamare)

### Analysis
To enable community sponsorship and incentivize open-source contributions, `srelens` requires an integrated bounty program mechanism. After evaluating the primary open-source funding platforms (Polar.sh, Algora, BountyHub):
- **Polar.sh** is recommended as the platform of choice: It seamlessly integrates with GitHub issues, renders dynamic bounty badges on funded issues, supports flexible payout distributions upon PR merges, and requires zero maintenance infrastructure.

This solution adds clear payout policies and contributor workflows in `CONTRIBUTING.md` and adds the program badge to the `README.md` community badge row.

### Fix
1. Add a **Bounty Program & Payout Policy** section to `CONTRIBUTING.md`.
2. Add the **Polar.sh Bounty Badge** into the community badges row in `README.md`.

### Implementation

#### `CONTRIBUTING.md`
```markdown
## 💰 Bounty Program

We use [Polar.sh](https://polar.sh/srelens) to manage issue bounties and reward open-source contributors.

### How to Fund an Issue
Sponsors and community members can fund specific features or bug fixes:
1. Go to our [Polar.sh Dashboard](https://polar.sh/srelens) or click the **Fund** link on supported GitHub issues.
2. Select an amount to pledge to the issue.
3. Pledges are held securely by Polar until the issue resolution is accepted and merged.

### How to Earn Bounties
1. **Browse Funded Issues**: Filter issues by the `bounty` label on GitHub or check our [Polar.sh Page](https://polar.sh/srelens).
2. **Express Interest**: Leave a comment on the issue indicating you are working on a fix to avoid duplicate efforts.
3. **Submit Your Fix**: Open a PR referencing the issue (e.g., `Fixes #123`). Ensure tests pass and commits include a DCO sign-off.
4. **Receive Payout**: Once maintainers review and merge your PR into `main`, Polar transfers the bounty directly to your connected account.

### Payout & Rules Policy
- **Validation**: Bounties are paid out only after the PR is merged into `main`.
- **Multiple Contributors**: If a solution requires co-authors, maintainers can split payouts proportionally via Polar.
- **Inactivity Policy**: If an assigned issue sees no activity for 14 days, assignment may be reassigned.
```

#### `README.md`
```markdown
<!-- Community & Funding Badges -->
[![Polar Bounties](https://polar.sh/embed/bounty/srelens/srelens.svg)](https://polar.sh/srelens/srelens)
[![Discord](https://img.shields.io/discord/123456789?style=flat&logo=discord&label=community)](https://discord.gg/srelens)
[![GitHub Discussions](https://img.shields.io/badge/discussions-active-blue?style=flat&logo=github)](https://github.com/srelens/srelens/discussions)
```

### Testing
- Markdown syntax validated via `markdownlint`.
- Link and SVG badge preview tested against standard GitHub dark and light themes.

Signed-off-by: Aditya Waghamare <adityawaghamare7620@gmail.com>

---
*Submitted by Aditya Waghamare*
💰 **Payout Address (Base L2 / EVM):** `0xb61dBcdBc3407F71EaCb64D4CBFAcf9FFfe2415C`