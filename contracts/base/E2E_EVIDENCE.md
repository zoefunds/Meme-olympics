# Live Base Sepolia settlement evidence

Recorded on 31 October 2026 against the current production escrow
`0x951773259a9c90bE6DCfB5C9E4aedA9fBe89F10c`, after the GenLayer production
switchover to `0xC91AA2316235D6a1cCd6804Ad1cC85D29E6F14ea`.

This is a live proof of the Base payment leg: approve official Base Sepolia
USDC, fund an escrow pool, allocate one winner, and claim exactly 1 USDC. The
authorized test wallet acted as host, relayer, and winner so no private key or
third-party wallet was needed. The test identifier was
`live-e2e-c91aa231-20261031-01`; its on-chain `bytes32` key is
`0x75a622acbac5c48e47b55de2584aed71260c0798c4360da0ddff4139010ec9fa`.

| Step | Transaction | Block | Result |
| --- | --- | ---: | --- |
| Approve 1 USDC | [`0x5781…8bc8`](https://sepolia.basescan.org/tx/0x5781c64123134ff0d14b6b882b6052afcdaaae7f87275f6f9bdb5fe654358bc8) | 52668645 | success |
| Fund escrow | [`0xc19c…0ebd`](https://sepolia.basescan.org/tx/0xc19c9b5d4e571a4e8f6d63bd1830bc2006bfd22fabaeeb24f84ada4694160ebd) | 52668655 | success |
| Allocate winner | [`0xce48…be80`](https://sepolia.basescan.org/tx/0xce48bba82ef3b85fa5f423a95ced69be4471b876956ccf435bf2caf6532fbe80) | 52668666 | success |
| Claim 1 USDC | [`0x9551…d505`](https://sepolia.basescan.org/tx/0x9551c00dcd81e42de84a9971eea36989d6f6512758bd8979921b3432d201d505) | 52668683 | success |

Independent post-run RPC reads returned:

- deposited: `1000000` USDC base units;
- allocated: `1000000` USDC base units;
- winners set: `true`;
- winner claimable after claim: `0`;
- all four transaction receipt statuses: `1`.

The allocation used an already-passed test unlock timestamp, exercising the
same immediate-claim state produced when the backend relays a finalized
competition after its GenLayer challenge window. This record proves the live
escrow's financially consequential fund/allocation/claim path. It is not
presented as evidence that this synthetic key corresponds to an adjudicated
meme competition on GenLayer.
