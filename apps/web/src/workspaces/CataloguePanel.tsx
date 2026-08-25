import { useCallback, useEffect, useState } from 'react';

import { showToast } from '../toast.js';

interface VodCategory {
  mediaType: 'vod' | 'series';
  providerGroup: string;
  itemCount: number;
  enabled: boolean;
  storedCount: number;
  lastSeenAt: string;
}

async function readJson<T>(response: Response): Promise<T> {
  const value: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof value === 'object' &&
      value !== null &&
      'error' in value &&
      typeof value.error === 'string'
        ? value.error
        : 'Request failed';
    throw new Error(message);
  }
  return value as T;
}

interface CataloguePanelProps {
  active: boolean;
  sourceId?: string;
}

/**
 * A provider's catalogue is far larger than its live lineup — hundreds of
 * thousands of titles is normal — so this lists categories rather than
 * titles, and only the ones switched on are stored and published.
 */
export function CataloguePanel({ active, sourceId }: CataloguePanelProps) {
  const [categories, setCategories] = useState<VodCategory[] | null>(null);
  const [filter, setFilter] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [showEnabledOnly, setShowEnabledOnly] = useState(false);

  const load = useCallback(async () => {
    if (!sourceId) return;
    const response = await fetch(`/api/v1/sources/${sourceId}/vod-categories`);
    const payload = await readJson<{ categories: VodCategory[] }>(response);
    setCategories(payload.categories);
  }, [sourceId]);

  useEffect(() => {
    if (!active || !sourceId) return;
    void load().catch(() => {
      // A provider that has never been imported simply has no catalogue yet.
      setCategories([]);
    });
  }, [active, sourceId, load]);

  async function setEnabled(category: VodCategory, enabled: boolean) {
    if (!sourceId) return;
    const key = `${category.mediaType} ${category.providerGroup}`;
    setSaving(key);
    try {
      const response = await fetch(
        `/api/v1/sources/${sourceId}/vod-categories`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            mediaType: category.mediaType,
            providerGroup: category.providerGroup,
            enabled,
          }),
        },
      );
      const payload = await readJson<{ categories: VodCategory[] }>(response);
      setCategories(payload.categories);
      showToast(
        'success',
        enabled
          ? `${category.providerGroup || 'Uncategorised'} will be included at the next refresh`
          : `${category.providerGroup || 'Uncategorised'} removed`,
      );
    } catch (caught) {
      showToast(
        'error',
        caught instanceof Error
          ? caught.message
          : 'Could not change the category',
      );
    } finally {
      setSaving(null);
    }
  }

  if (!active) return null;
  if (!sourceId) return null;

  const normalized = filter.trim().toLocaleLowerCase();
  const sections: Array<{ mediaType: 'vod' | 'series'; heading: string }> = [
    { mediaType: 'vod', heading: 'MOVIES' },
    { mediaType: 'series', heading: 'SERIES' },
  ];

  return (
    <>
      {categories === null ? null : categories.length === 0 ? (
        <section className="panel">
          <p className="secret-note">
            No film or series categories have been seen yet. They are recorded
            during a playlist refresh, so import this provider once and they
            will appear here.
          </p>
        </section>
      ) : (
        <section className="panel catalogue-panel">
          <p className="secret-note">
            Your provider offers far more titles than channels, so nothing here
            is stored until you ask for it. Switching a category on keeps its
            titles from the next refresh onwards; switching it off removes them
            straight away. Publish them with an output URL of the matching kind
            on the overview page.
          </p>
          <div className="channel-search">
            <input
              aria-label="Filter categories"
              placeholder="Search categories"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
            <label className="hidden-group-toggle">
              <input
                type="checkbox"
                checked={showEnabledOnly}
                onChange={(event) => setShowEnabledOnly(event.target.checked)}
              />
              Only included
            </label>
          </div>

          {sections.map((section) => {
            const rows = categories.filter(
              (category) =>
                category.mediaType === section.mediaType &&
                (normalized
                  ? category.providerGroup
                      .toLocaleLowerCase()
                      .includes(normalized)
                  : true) &&
                (showEnabledOnly ? category.enabled : true),
            );
            const includedCount = categories.filter(
              (category) =>
                category.mediaType === section.mediaType && category.enabled,
            ).length;
            const titleCount = categories
              .filter(
                (category) =>
                  category.mediaType === section.mediaType && category.enabled,
              )
              .reduce((total, category) => total + category.itemCount, 0);

            return (
              <div className="catalogue-section" key={section.mediaType}>
                <div className="subsection-heading">
                  <div>
                    <small>{section.heading}</small>
                    <strong>
                      {includedCount.toLocaleString()} of{' '}
                      {categories
                        .filter(
                          (category) =>
                            category.mediaType === section.mediaType,
                        )
                        .length.toLocaleString()}{' '}
                      categories included
                    </strong>
                  </div>
                  <span className="channel-count">
                    {titleCount.toLocaleString()} titles
                  </span>
                </div>
                <div className="catalogue-list">
                  {rows.map((category) => {
                    const key = `${category.mediaType} ${category.providerGroup}`;
                    const pending =
                      category.enabled && category.storedCount === 0;
                    return (
                      <div className="catalogue-row" key={key}>
                        <span className="group-select-text">
                          <strong>
                            {category.providerGroup || '(Uncategorised)'}
                          </strong>
                          <small>
                            {category.itemCount.toLocaleString()} titles offered
                            {category.enabled
                              ? pending
                                ? ' · waiting for the next refresh'
                                : ` · ${category.storedCount.toLocaleString()} stored`
                              : ''}
                          </small>
                        </span>
                        <label className="permanent-visibility-toggle">
                          <input
                            type="checkbox"
                            checked={category.enabled}
                            disabled={saving !== null}
                            onChange={(event) =>
                              void setEnabled(category, event.target.checked)
                            }
                          />
                          {saving === key
                            ? 'Saving…'
                            : category.enabled
                              ? 'Included'
                              : 'Excluded'}
                        </label>
                      </div>
                    );
                  })}
                  {rows.length === 0 ? (
                    <p className="empty-groups">No categories match.</p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </section>
      )}
    </>
  );
}
