//! Genesis presets. The founding set are members of community 0 with keys, so
//! they both validate and can witness the first admissions. No endowments: KAB
//! at genesis is only the founders' admission mint plus any snapshot waiting to
//! be claimed.

use crate::{AccountId, RuntimeGenesisConfig, SeedKeys, SeedsConfig, KAB};
use alloc::{vec, vec::Vec};
use frame_support::build_struct_json_patch;
use serde_json::Value;
use sp_genesis_builder::{self, PresetId};
use sp_keyring::{Ed25519Keyring, Sr25519Keyring};

fn keys(k: Sr25519Keyring, g: Ed25519Keyring) -> SeedKeys {
	SeedKeys { aura: k.public().into(), grandpa: g.public().into() }
}

fn genesis(founders: Vec<(AccountId, Option<SeedKeys>)>, claims: Vec<([u8; 32], u128)>) -> Value {
	let authorities: Vec<SeedKeys> = founders.iter().filter_map(|(_, k)| k.clone()).collect();
	build_struct_json_patch!(RuntimeGenesisConfig {
		aura: pallet_aura::GenesisConfig {
			authorities: authorities.iter().map(|k| k.aura.clone()).collect::<Vec<_>>(),
		},
		grandpa: pallet_grandpa::GenesisConfig {
			authorities: authorities.iter().map(|k| (k.grandpa.clone(), 1)).collect::<Vec<_>>(),
		},
		seeds: SeedsConfig { founders, founding_cap: 10, claims },
	})
}

/// Ferdie stands in for a holder of the old chain, so the claim path can be
/// exercised on a dev chain. Ferdie is not a founder.
fn demo_claims() -> Vec<([u8; 32], u128)> {
	vec![(Sr25519Keyring::Ferdie.public().0, 1_000 * KAB)]
}

pub fn development_config_genesis() -> Value {
	genesis(
		vec![(
			Sr25519Keyring::Alice.to_account_id(),
			Some(keys(Sr25519Keyring::Alice, Ed25519Keyring::Alice)),
		)],
		demo_claims(),
	)
}

/// Alice and Bob found and validate, Charlie founds without keys, so a third
/// voice exists from the start without a third validator.
pub fn local_config_genesis() -> Value {
	genesis(
		vec![
			(Sr25519Keyring::Alice.to_account_id(), Some(keys(Sr25519Keyring::Alice, Ed25519Keyring::Alice))),
			(Sr25519Keyring::Bob.to_account_id(), Some(keys(Sr25519Keyring::Bob, Ed25519Keyring::Bob))),
			(Sr25519Keyring::Charlie.to_account_id(), None),
		],
		demo_claims(),
	)
}

pub fn get_preset(id: &PresetId) -> Option<Vec<u8>> {
	let patch = match id.as_ref() {
		sp_genesis_builder::DEV_RUNTIME_PRESET => development_config_genesis(),
		sp_genesis_builder::LOCAL_TESTNET_RUNTIME_PRESET => local_config_genesis(),
		_ => return None,
	};
	Some(
		serde_json::to_string(&patch)
			.expect("serialization to json is expected to work. qed.")
			.into_bytes(),
	)
}

pub fn preset_names() -> Vec<PresetId> {
	vec![
		PresetId::from(sp_genesis_builder::DEV_RUNTIME_PRESET),
		PresetId::from(sp_genesis_builder::LOCAL_TESTNET_RUNTIME_PRESET),
	]
}
