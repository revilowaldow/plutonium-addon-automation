import {ConverterUtil} from "./ConverterUtil.js";
import {NameIdGenerator} from "./NameIdGenerator.js";

class _ActivitiesPreProcessor {
	static getActivities (json) {
		const activities = foundry.utils.duplicate(Object.values(json.system.activities));

		const idToCntUsed = this._getIdToCnt({activities});

		if (!Object.keys(idToCntUsed).length) return activities;

		const nameIdGenerator = new NameIdGenerator({name: json.name});

		this._mutIds({activities, idToCntUsed, nameIdGenerator});

		return activities;
	}

	static _getIdToCnt ({activities}) {
		const idToCntUsed = {};

		activities
			.forEach(activity => {
				activity.effects
					?.forEach(effRef => {
						effRef.riders?.activity
							?.forEach(activityId => {
								idToCntUsed[activityId] = (idToCntUsed[activityId] || 0) + 1;
							});
					});
			});

		return idToCntUsed;
	}

	static _mutIds ({activities, idToCntUsed, nameIdGenerator}) {
		const idToHumanId = Object.fromEntries(
			Object.keys(idToCntUsed)
				.map(id => [id, nameIdGenerator.getNextId()]),
		);

		activities
			.forEach(activity => {
				activity.effects
					?.forEach(effRef => {
						if (!effRef.riders?.activity?.length) return;

						effRef.riders.activity = effRef.riders.activity
							.map(id => ({foundryId: idToHumanId[id]}));
					});

				if (idToHumanId[activity._id]) activity.foundryId = idToHumanId[activity._id];
			});
	}
}

export class ActivityConverter {
	static _ActivityConverterState = class {
		constructor ({name}) {
			this._nameIdGeneratorEffects = new NameIdGenerator({name});
		}

		getNextEffectId () { return this._nameIdGeneratorEffects.getNextId(); }
	};

	static getActivities ({json, foundryIdToConsumptionTarget = null}) {
		if (!Object.keys(json.system?.activities || {}).length) {
			delete json.system.activities;
			return {};
		}

		const name = json.name;
		if (!name) throw new Error(`Item "${json._id}" did not have a name!`);

		const cvState = new this._ActivityConverterState({name});
		const effectIdLookup = {};

		const activitiesPreProcessedIds = _ActivitiesPreProcessor.getActivities(json);

		const activities = activitiesPreProcessedIds
			.map(activity => this._getActivity({json, foundryIdToConsumptionTarget, cvState, activity, effectIdLookup}))
			.filter(Boolean);

		if (activities.length === 1) {
			delete activities[0].img;
		}

		delete json.system.activities;

		return {
			activities,
			effectIdLookup,
		};
	}

	static _getActivity ({json, foundryIdToConsumptionTarget, cvState, activity, effectIdLookup}) {
		activity = this._getPreClean({json, activity});

		this._mutEffects({json, cvState, activity, effectIdLookup});

		this._mutConsumption({activity, foundryIdToConsumptionTarget});

		this._mutPostClean(activity);

		return activity;
	}

	static _getPreClean ({json, activity}) {
		this._getPreClean_mutNonSpell({json, activity});
		this._getPreClean_mutSummon({json, activity});

		if (activity.duration?.units === "inst") delete activity.duration.units;
		if (activity.range?.units === "self") delete activity.range.units;

		if (!activity.target?.template?.type) delete activity.target.template;
		delete activity.target?.prompt;

		Object.entries(activity)
			.forEach(([k, v]) => {
				if (typeof v !== "object") return;
				if (!v.override) return;
				console.warn(`"override" found in "${k}" for activity:\n\t${JSON.stringify(activity)}`);
				delete v.override;
			});

		const out = ConverterUtil.getWithoutFalsy(
			activity,
			{
				pathsRetain: [
					"activation.type", // the default is "action"; 'empty string' is a specific "None"
				],
			},
		);

		["sort"].forEach(prop => delete out[prop]);

		return out;
	}

	/**
	 * Remove spell-specific data from non-spell activities
	 */
	static _getPreClean_mutNonSpell ({json, activity}) {
		if (json.type === "spell") return;

		delete activity?.consumption?.spellSlot;

		if (activity.damage?.parts?.length) {
			activity.damage.parts.forEach(dmgPart => delete dmgPart?.scaling?.number);
		}
	}

	static _getPreClean_mutSummon ({json, activity}) {
		if (activity.type !== "summon") return;

		delete activity?.summon?.prompt;

		activity.profiles
			?.forEach(profile => {
				delete profile._id;
			});
	}

	static _mutPostClean (act) {
		["_id"].forEach(prop => delete act[prop]);
	}

	/* -------------------------------------------- */

	static _mutEffects ({json, cvState, activity, effectIdLookup}) {
		if (!activity.effects?.length) return;

		activity.effects = activity.effects.map(effRef => this._getMutEffect({json, cvState, effRef, effectIdLookup}));

		return effectIdLookup;
	}

	static _getMutEffect ({json, cvState, effRef, effectIdLookup}) {
		const effRefOut = {};

		this._getMutEffect_id({json, cvState, effRef, effRefOut, effectIdLookup});
		this._getMutEffect_riders({json, cvState, effRef, effRefOut, effectIdLookup});

		if (Object.keys(effRef).length) throw new Error(`Unexpected keys in activity effect "${JSON.stringify(effRef)}" for document "${json.name}"!`);

		return effRefOut;
	}

	static _getMutEffect_id ({json, cvState, effRef, effRefOut, effectIdLookup}) {
		if (!effRef._id) throw new Error(`Missing "_id" key in effect reference "${JSON.stringify(effRef)}" for document "${json.name}"!`);
		if (effectIdLookup[effRef._id]) {
			effRefOut.foundryId = effectIdLookup[effRef._id];
		} else {
			effectIdLookup[effRef._id] = effRefOut.foundryId = cvState.getNextEffectId();
		}
		delete effRef._id;
	}

	static _getMutEffect_riders ({json, cvState, effRef, effRefOut, effectIdLookup}) {
		if (effRef.riders?.activity?.length) {
			// Activity IDs are pre-mapped, therefore just copy
			foundry.utils.setProperty(effRefOut, "riders.activity", effRef.riders.activity);
			delete effRef.riders.activity;
		}

		if (effRef.riders?.effect?.length) {
			throw new Error(`Unhandled "effect" riders in "${JSON.stringify(effRef)}" for document "${json.name}"!`);
			// delete effRef.riders.effect;
		}

		if (effRef.riders?.item?.length) {
			throw new Error(`Unhandled "item" riders in "${JSON.stringify(effRef)}" for document "${json.name}"!`);
			// delete effRef.riders.item;
		}

		delete effRef.riders;
	}

	/* -------------------------------------------- */

	static _CONSUMPTION_RESOURCE_MAPPINGS = {
		// Cleric
		"phbclcChannelDiv": "Channel Divinity",

		// Monk
		"phbmnkMonksFocus": "Focus Point",

		// Paladin
		"phbpdnChannelDiv": "Channel Divinity",

		// Sorcerer
		"phbscrFontOfMagi": "Sorcery Point",
	};

	static _mutConsumption ({activity, foundryIdToConsumptionTarget}) {
		if (!activity.consumption?.targets?.length) return;

		activity.consumption.targets
			.forEach(consTarget => {
				if (consTarget.type !== "itemUses") return;
				if (!consTarget.target) return;

				// Compendium.dnd-players-handbook.classes.Item.phbbrbRage000000
				const foundryUuidParts = consTarget.target.split(".").map(it => it.trim()).filter(Boolean);

				const consumesName = this._CONSUMPTION_RESOURCE_MAPPINGS[foundryUuidParts.at(-1)];
				if (consumesName) {
					consTarget.target = {
						consumes: {
							name: consumesName,
						},
					};
					return;
				}

				const fromLookup = foundryUuidParts.at(-1)
					? foundryIdToConsumptionTarget?.[foundryUuidParts.at(-1)]
					: null;
				if (fromLookup) {
					consTarget.target = fromLookup;
					return;
				}

				// Migrate manually; placeholder values to trigger schema error
				consTarget.target = {
					prop: true,
					uid: true,
				};
			});
	}
}
