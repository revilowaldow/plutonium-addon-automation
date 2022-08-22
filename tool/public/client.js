"use strict";

class ConverterUi {
	static _iptFile = null;
	static _iptText = null;
	static _btnConvert = null;
	static _btnCopy = null;
	static _outText = null;

	static _onChange_file () {
		const reader = new FileReader();
		reader.readAsText(this._iptFile.files[0]);

		const getPreConvertedTextMeta = () => {
			// Check whether filetype is legal
			if (this._iptFile.value.match(/\.(json|txt)$/i) || !this._iptFile.value.includes(".")) { // .json, .txt, or no filetype
				return {text: reader.result, error: null};
			}

			if (this._iptFile.value.match(/\.db$/i)) { // .db
				return {
					text: JSON.stringify(reader.result.split("\n").filter(it => it.length).map(it => JSON.parse(it)), null, "\t"),
					error: null,
				};
			}

			return {
				text: "Failed to parse input text!\n\n> Invalid filetype",
				error: `Failed to load invalid filetype: .${this._iptFile.value.split(".").slice(-1)[0]}`,
			};
		};

		reader.onload = () => {
			const {text, error} = getPreConvertedTextMeta();

			this._iptText.value = text;
			if (error) {
				console.error(error);
				return;
			}

			this._doConvert();
		};
	}

	static async _pOnClick_btnCopy () {
		await navigator.clipboard.writeText(this._outText.value);
		this._btnCopy.innerHTML = "Copied ✓";
		console.log("Copied!");
		window.setTimeout(() => this._btnCopy.innerHTML = "Copy", 500);
	}

	static _doConvert () {
		try {
			this._doConvert_();
		} catch (e) {
			this._outText.value = `Failed to parse input text!\n\n${e}`;
			throw e;
		}
	}

	static _doConvert_ () {
		this._outText.value = JSON.stringify(Converter.getConverted(JSON.parse(this._iptText.value)), null, "\t");
	}

	static init () {
		this._iptFile = document.getElementById("ipt-file");
		this._iptText = document.getElementById("ipt-text");
		this._btnConvert = document.getElementById("btn-convert");
		this._btnCopy = document.getElementById("btn-copy");
		this._outText = document.getElementById("out-text");

		this._iptFile.addEventListener("change", this._onChange_file.bind(this));
		this._btnConvert.addEventListener("click", this._doConvert.bind(this));
		this._btnCopy.addEventListener("click", this._pOnClick_btnCopy.bind(this));
	}
}

class ConverterUtil {
	static copyTruthy (out, obj, {additionalFalsyValues = null} = {}) {
		Object.entries(obj)
			.forEach(([k, v]) => {
				if (additionalFalsyValues && additionalFalsyValues.has(v)) return;

				if (!v) return;
				if (v instanceof Array && !v.length) return;
				if (typeof v === "object" && !Object.keys(v).length) return;

				out[k] = v;
			});
	}
}

class Converter {
	static getConverted (json) {
		if (json instanceof Array) return json.map(it => this.getConverted(it));

		const effects = EffectConverter.getEffects(json);
		const flags = FlagConverter.getFlags(json);

		return {
			name: json.name,
			source: this._getSource(json),
			effects,
			flags,
		};
	}

	static _getSource (json) {
		const sourceRaw = json.data?.source;
		if (!sourceRaw) return null;
		return sourceRaw.split(/[,;.]/g)[0].trim();
	}
}

class FlagConverter {
	static getFlags (json) {
		if (!Object.keys(json.flags || {}).length) return;

		const out = {};

		Object.entries(json.flags)
			.forEach(([k, flags]) => {
				switch (k) {
					// region Discard these
					case "srd5e":
					case "core":
					case "favtab": // https://github.com/syl3r86/favtab
						break;
						// endregion

					// region Handle these
					case "midi-qol": {
						const outSub = {};
						ConverterUtil.copyTruthy(outSub, flags);
						if (Object.keys(outSub).length) out[k] = outSub;
						break;
					}
					case "midiProperties": {
						const outSub = {};
						ConverterUtil.copyTruthy(outSub, flags);
						if (Object.keys(outSub).length) out[k] = outSub;
						break;
					}
					case "enhanced-terrain-layer": {
						const outSub = {};
						ConverterUtil.copyTruthy(outSub, flags);
						if (Object.keys(outSub).length) out[k] = outSub;
						break;
					}
					// endregion

					default: {
						console.warn(`Unknown flag property "${k}"--copying as-is`);
						out[k] = flags;
					}
				}
			});

		if (Object.keys(out).length) return out;
	}
}

class EffectConverter {
	static getEffects (json) {
		if (!json.effects?.length) return;

		return json.effects
			.map(eff => this._getEffect(eff))
			.filter(Boolean);
	}

	static _getEffect (eff) {
		this._mutPreClean(eff);

		this._mutChanges(eff);

		this._mutFlags(eff);
		this._mutDuration(eff);

		if (!eff.changes?.length && !Object.keys(eff.flags || {}).length) return null;

		this._mutRequires(eff);

		return eff;
	}

	static _mutPreClean (eff) {
		// N.b. "selectedKey" is midi-qol UI QoL tracking data, and can be safely skipped
		["_id", "icon", "label", "origin", "tint", "selectedKey", "disabled", "transfer"].forEach(prop => delete eff[prop]);
	}

	static _mutChanges (eff) {
		if (!eff.changes?.length) return delete eff.changes;

		eff.changes = eff.changes.map(it => ({...it, mode: this._getChangeMode(it.mode)}));
	}

	static _FLAGS_FALSY_VALUES = new Set([
		// region dae
		"none",
		// endregion

		// region ActiveAuras
		"None",
		// endregion

		// region dnd5e-helpers
		"Ignore",
		// endregion
	]);

	static _mutFlags (eff) {
		if (!Object.keys(eff.flags || {}).length) return delete eff.flags;

		const flagsNxt = {};
		Object.entries(eff.flags)
			.forEach(([namespace, moduleFlags]) => {
				const moduleFlagsNxt = {};
				ConverterUtil.copyTruthy(moduleFlagsNxt, moduleFlags, {additionalFalsyValues: this._FLAGS_FALSY_VALUES});
				if (Object.keys(moduleFlagsNxt).length) flagsNxt[namespace] = moduleFlagsNxt;
			});

		if (Object.keys(flagsNxt).length) eff.flags = flagsNxt;
		else delete eff.flags;
	}

	static _mutDuration (eff) {
		if (!eff.duration) return;

		const durationNxt = {};
		ConverterUtil.copyTruthy(durationNxt, eff.duration);
		if (Object.keys(durationNxt).length) eff.duration = durationNxt;
		else delete eff.duration;
	}

	static _mutRequires (eff) {
		const requires = {};

		(eff.changes || [])
			.forEach(it => {
				const [ptFlags, ptModule] = (it.key || "").split(".").slice(0, 2);
				if (ptFlags !== "flags") return;
				const moduleId = this._getRequiresModuleId(ptModule);
				if (!moduleId) return;
				requires[moduleId] = true;
			});

		Object.keys(eff.flags || {})
			.forEach(k => {
				const moduleId = this._getRequiresModuleId(k);
				if (!moduleId) return;
				requires[moduleId] = true;
			});

		if (Object.keys(requires).length) eff.requires = requires;
	}

	static _getRequiresModuleId (flagKey) {
		switch (flagKey) {
			// If the key matches the module's ID
			case "ActiveAuras":
			case "dae":
			case "dnd5e-helpers":
			case "midi-qol":
				return flagKey;

			default: return null;
		}
	}

	static _getChangeMode (modeRaw) {
		switch (modeRaw) {
			case 0: return "CUSTOM";
			case 1: return "MULTIPLY";
			case 2: return "ADD";
			case 3: return "DOWNGRADE";
			case 4: return "UPGRADE";
			case 5: return "OVERRIDE";
			default: return modeRaw;
		}
	}
}

window.addEventListener("load", () => ConverterUi.init());
