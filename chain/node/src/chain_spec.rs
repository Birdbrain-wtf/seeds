use sc_service::ChainType;
use seeds_runtime::WASM_BINARY;

/// Specialized `ChainSpec`. This is a specialization of the general Substrate ChainSpec type.
pub type ChainSpec = sc_service::GenericChainSpec;

/// A generic unit at 12 decimals; a network running the protocol names its own, so wallets show amounts the way the chain means them.
fn properties() -> sc_service::Properties {
	let mut p = sc_service::Properties::new();
	p.insert("tokenSymbol".into(), "UNIT".into());
	p.insert("tokenDecimals".into(), 12.into());
	p.insert("ss58Format".into(), 42.into());
	p
}

pub fn development_chain_spec() -> Result<ChainSpec, String> {
	Ok(ChainSpec::builder(
		WASM_BINARY.ok_or_else(|| "Development wasm not available".to_string())?,
		None,
	)
	.with_name("Birdbrain Seeds (dev)")
	.with_id("seeds_dev")
	.with_properties(properties())
	.with_chain_type(ChainType::Development)
	.with_genesis_config_preset_name(sp_genesis_builder::DEV_RUNTIME_PRESET)
	.build())
}

pub fn local_chain_spec() -> Result<ChainSpec, String> {
	Ok(ChainSpec::builder(
		WASM_BINARY.ok_or_else(|| "Development wasm not available".to_string())?,
		None,
	)
	.with_name("Birdbrain Seeds (local)")
	.with_id("seeds_local")
	.with_properties(properties())
	.with_chain_type(ChainType::Local)
	.with_genesis_config_preset_name(sp_genesis_builder::LOCAL_TESTNET_RUNTIME_PRESET)
	.build())
}
