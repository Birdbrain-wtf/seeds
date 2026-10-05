# profiles

The protocol is the rules in [`spec/`](../spec) and [`chain/`](../chain). A **profile** is a network that runs them with its own settings, and may add arrangements of its own above them.

A profile sets the unit's name, the amount created per contribution, the number of witnesses, the allowances and caps, the length of a period and of a challenge window, and the number of seats. It may add funding, licences, prices and payment, as contracts between people kept off the chain. It may never add anything that mints, gives a vote, or gives a place in line to whoever funds or contracts with a group. A profile that needs one of those is a different protocol.

| Profile | What it is |
| --- | --- |
| [`chaos-sessions/`](chaos-sessions) | A weekly open call. Unpaid, run as part of membership. The first group whose sessions produced Seeds, and the tooling it uses to turn sessions into records. |

Nothing in a profile folder is needed to run the protocol.
