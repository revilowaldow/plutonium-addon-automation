import {SharedConsts} from "../shared/SharedConsts.js";
import {Util} from "./Util.js";
import {OptionalDependenciesManager} from "./OptionalDependenciesManager.js";
import {SettingsManager} from "./SettingsManager.js";
import {Api} from "./Api.js";
import {Integrations} from "./integrations/Integrations.js";

class Main {
	static _HAS_FAILED = false;

	static _STARTUP_CLAZZES = [
		Api,
		SettingsManager,
		OptionalDependenciesManager,
		Integrations,
	];

	static onHookInit () {
		if (this._HAS_FAILED) return;
		try {
			this._onHookInit();
		} catch (e) {
			this._onError(e);
		}
	}

	static _onHookInit () {
		this._STARTUP_CLAZZES
			.forEach(clazz => clazz.onHookInit());
	}

	static onHookReady () {
		if (this._HAS_FAILED) return;
		try {
			this._onHookReady();
		} catch (e) {
			this._onError(e);
		}
	}

	static _onHookReady () {
		this._STARTUP_CLAZZES
			.forEach(clazz => clazz.onHookReady());

		console.log(...Util.LGT, `Initialized.`);
	}

	static _onError (e) {
		this._HAS_FAILED = true;
		setTimeout(() => { throw e; });
		if (ui.notifications?.error) ui.notifications.error(`Failed to initialize ${SharedConsts.MODULE_TITLE}! ${VeCt.STR_SEE_CONSOLE}`);
	}
}

Hooks.on("init", Main.onHookInit.bind(Main));
Hooks.on("ready", Main.onHookReady.bind(Main));
