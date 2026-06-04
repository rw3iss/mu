import { signal } from '@preact/signals';
import { getUiSetting, setUiSetting } from '@/hooks/useUiSetting';
import { groupsService, type MovieGroup } from '@/services/groups.service';

/**
 * Whether the Library page should render parent groups as collapsed
 * tiles. When false, every movie shows individually regardless of
 * grouping. Per-user, persisted via useUiSetting.
 */
export const groupViewEnabled = signal<boolean>(getUiSetting('library_group_view', true));

export function setGroupViewEnabled(v: boolean): void {
	groupViewEnabled.value = v;
	setUiSetting('library_group_view', v);
}

export function toggleGroupView(): void {
	setGroupViewEnabled(!groupViewEnabled.value);
}

/**
 * Filter the Library to ONLY items that belong to a group — i.e.
 * series, seasons, collections. Combines with `groupViewEnabled`:
 *   - groupedOnly + groupViewEnabled  → show only group tiles
 *   - groupedOnly + !groupViewEnabled → show every episode/member
 *     of every group, flat
 *   - !groupedOnly                    → show everything (default)
 */
export const groupedOnly = signal<boolean>(getUiSetting('library_grouped_only', false));

export function setGroupedOnly(v: boolean): void {
	groupedOnly.value = v;
	setUiSetting('library_grouped_only', v);
}

export function toggleGroupedOnly(): void {
	setGroupedOnly(!groupedOnly.value);
}

/**
 * Cache of parent groups for the library page. Populated on demand —
 * we don't auto-fetch on app boot since most users won't open the
 * Library page first.
 */
export const parentGroups = signal<MovieGroup[]>([]);
export const groupsLoaded = signal<boolean>(false);

/**
 * Groups (stacks) that fall within the CURRENT library page, returned inline by
 * the movies list endpoint when `interleaveGroups=true`. Unlike `parentGroups`
 * (all groups, used by the collections-only tile grid), this is paginated +
 * sorted alongside the page's ungrouped movies for the mixed view.
 */
export const pageGroups = signal<MovieGroup[]>([]);

export async function fetchParentGroups(): Promise<void> {
	try {
		const { groups } = await groupsService.listParents();
		parentGroups.value = groups;
		groupsLoaded.value = true;
	} catch {
		// Endpoint may be unavailable on older builds — keep empty.
		groupsLoaded.value = true;
	}
}

export function invalidateGroups(): void {
	groupsLoaded.value = false;
	parentGroups.value = [];
}
