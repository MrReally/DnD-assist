export interface ReferenceRef {
	provider: string;
	ref: string;
}

export interface ReferenceHit {
	ref: ReferenceRef;
	name: string;
	subtitle: string;
	url: string | null;
}

export interface CreatureSummary {
	name: string;
	ac: number | null;
	hpMax: number | null;
	initiativeModifier: number | null;
	speed: string;
	notes: string;
	sourceUrl: string | null;
}

/** Contract from the specification (section 6.1). */
export interface ReferenceProvider {
	readonly id: string;
	search(query: string): Promise<ReferenceHit[]>;
	getSummary(ref: ReferenceRef): Promise<CreatureSummary | null>;
	getSourceUrl(ref: ReferenceRef): string;
	isAvailable(): Promise<boolean>;
}
