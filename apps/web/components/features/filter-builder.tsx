'use client';

import { useState, useCallback, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent, Badge, Button, Input } from '@/components/ui';
import { X, Plus, Bell, BellOff, Save, Trash2, Filter, ChevronDown, ChevronUp } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import type { FilterQuery } from '@/lib/data/filtering';

/**
 * Saved filter structure
 */
export interface SavedFilter {
  id: string;
  name: string;
  query: FilterQuery;
  alertsEnabled: boolean;
  createdAt: string;
}

/**
 * FilterBuilder props
 */
export interface FilterBuilderProps {
  initialQuery?: FilterQuery;
  availablePatterns: string[];
  availableStages: string[];
  availableContinents: string[];
  availableVerticals: string[];
  taxonomyVerticals?: Array<{ id: string; label: string; count: number }>;
  taxonomySubVerticals?: Array<{ id: string; label: string; count: number }>;
  taxonomyLeaves?: Array<{ id: string; label: string; count: number }>;
  savedFilters: SavedFilter[];
  onFilterApply: (query: FilterQuery) => void;
  onFilterSave: (name: string, query: FilterQuery, alertsEnabled: boolean) => Promise<void>;
  onFilterDelete: (filterId: string) => Promise<void>;
  onFilterToggleAlerts: (filterId: string, enabled: boolean) => Promise<void>;
  className?: string;
}

function TaxonomySelect({
  label,
  value,
  options,
  placeholder,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string | undefined;
  options: Array<{ id: string; label: string; count?: number }>;
  placeholder: string;
  onChange: (value: string | undefined) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <label className="label-sm text-muted-foreground">{label}</label>
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value ? e.target.value : undefined)}
        disabled={disabled}
        className="w-full px-3 py-2 text-sm rounded-lg bg-muted/25 border border-border/50 text-foreground focus:outline-none focus:ring-1 focus:ring-accent-info/70 focus:border-accent-info/70 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <option value="">{placeholder}</option>
        {options.map(o => (
          <option key={o.id} value={o.id}>
            {o.label}{typeof o.count === 'number' ? ` (${o.count})` : ''}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Multi-select chip component
 */
function ChipSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
}) {
  const toggle = (option: string) => {
    if (selected.includes(option)) {
      onChange(selected.filter(s => s !== option));
    } else {
      onChange([...selected, option]);
    }
  };

  return (
    <div className="space-y-2">
      <label className="label-sm text-muted-foreground">{label}</label>
      <div className="flex flex-wrap gap-2">
        {options.map(option => (
          <button
            key={option}
            onClick={() => toggle(option)}
            className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
              selected.includes(option)
                ? 'bg-accent text-accent-foreground border-accent'
                : 'bg-muted/30 text-muted-foreground border-border/50 hover:bg-muted/50'
            }`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Funding range slider/input
 */
function FundingRange({
  min,
  max,
  onMinChange,
  onMaxChange,
}: {
  min: number | undefined;
  max: number | undefined;
  onMinChange: (val: number | undefined) => void;
  onMaxChange: (val: number | undefined) => void;
}) {
  const presets = [
    { label: 'Any', min: undefined, max: undefined },
    { label: '<$5M', min: 0, max: 5_000_000 },
    { label: '$5M-$20M', min: 5_000_000, max: 20_000_000 },
    { label: '$20M-$100M', min: 20_000_000, max: 100_000_000 },
    { label: '>$100M', min: 100_000_000, max: undefined },
  ];

  const isPresetSelected = (preset: typeof presets[0]) =>
    min === preset.min && max === preset.max;

  return (
    <div className="space-y-2">
      <label className="label-sm text-muted-foreground">Funding Range</label>
      <div className="flex flex-wrap gap-2">
        {presets.map(preset => (
          <button
            key={preset.label}
            onClick={() => {
              onMinChange(preset.min);
              onMaxChange(preset.max);
            }}
            className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
              isPresetSelected(preset)
                ? 'bg-accent text-accent-foreground border-accent'
                : 'bg-muted/30 text-muted-foreground border-border/50 hover:bg-muted/50'
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Active filter display
 */
function ActiveFilters({
  query,
  onClear,
  onClearAll,
  taxonomyLabelFor,
}: {
  query: FilterQuery;
  onClear: (key: keyof FilterQuery, value?: string) => void;
  onClearAll: () => void;
  taxonomyLabelFor?: (id: string | undefined) => string | undefined;
}) {
  const hasFilters =
    (query.stages?.length ?? 0) > 0 ||
    (query.patterns?.length ?? 0) > 0 ||
    (query.continents?.length ?? 0) > 0 ||
    (query.verticals?.length ?? 0) > 0 ||
    query.verticalId !== undefined ||
    query.subVerticalId !== undefined ||
    query.leafId !== undefined ||
    query.fundingMin !== undefined ||
    query.fundingMax !== undefined ||
    query.usesGenai !== undefined;

  if (!hasFilters) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 p-3 bg-muted/20 rounded-lg border border-border/30">
      <span className="text-sm text-muted-foreground">Active filters:</span>

      {query.stages?.map(stage => (
        <Badge key={stage} variant="secondary" className="gap-1">
          {stage}
          <button onClick={() => onClear('stages', stage)} className="hover:text-destructive">
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}

      {query.patterns?.map(pattern => (
        <Badge key={pattern} variant="secondary" className="gap-1">
          {pattern}
          <button onClick={() => onClear('patterns', pattern)} className="hover:text-destructive">
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}

      {query.continents?.map(continent => (
        <Badge key={continent} variant="secondary" className="gap-1">
          {continent}
          <button onClick={() => onClear('continents', continent)} className="hover:text-destructive">
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}

      {query.verticals?.map(vertical => (
        <Badge key={vertical} variant="secondary" className="gap-1">
          {vertical}
          <button onClick={() => onClear('verticals', vertical)} className="hover:text-destructive">
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}

      {query.verticalId && (
        <Badge variant="secondary" className="gap-1">
          {taxonomyLabelFor?.(query.verticalId) || query.verticalId}
          <button onClick={() => { onClear('verticalId'); onClear('subVerticalId'); onClear('leafId'); }} className="hover:text-destructive">
            <X className="h-3 w-3" />
          </button>
        </Badge>
      )}

      {query.subVerticalId && (
        <Badge variant="secondary" className="gap-1">
          {taxonomyLabelFor?.(query.subVerticalId) || query.subVerticalId}
          <button onClick={() => { onClear('subVerticalId'); onClear('leafId'); }} className="hover:text-destructive">
            <X className="h-3 w-3" />
          </button>
        </Badge>
      )}

      {query.leafId && (
        <Badge variant="secondary" className="gap-1">
          {taxonomyLabelFor?.(query.leafId) || query.leafId}
          <button onClick={() => onClear('leafId')} className="hover:text-destructive">
            <X className="h-3 w-3" />
          </button>
        </Badge>
      )}

      {(query.fundingMin !== undefined || query.fundingMax !== undefined) && (
        <Badge variant="secondary" className="gap-1">
          {query.fundingMin !== undefined && query.fundingMax !== undefined
            ? `${formatCurrency(query.fundingMin, true)}-${formatCurrency(query.fundingMax, true)}`
            : query.fundingMin !== undefined
            ? `>${formatCurrency(query.fundingMin, true)}`
            : `<${formatCurrency(query.fundingMax!, true)}`}
          <button onClick={() => { onClear('fundingMin'); onClear('fundingMax'); }} className="hover:text-destructive">
            <X className="h-3 w-3" />
          </button>
        </Badge>
      )}

      {query.usesGenai !== undefined && (
        <Badge variant="secondary" className="gap-1">
          {query.usesGenai ? 'GenAI' : 'Non-GenAI'}
          <button onClick={() => onClear('usesGenai')} className="hover:text-destructive">
            <X className="h-3 w-3" />
          </button>
        </Badge>
      )}

      <button
        onClick={onClearAll}
        className="text-xs text-muted-foreground hover:text-destructive transition-colors"
      >
        Clear all
      </button>
    </div>
  );
}

/**
 * FilterBuilder component
 */
function hasActiveFilters(q: FilterQuery | undefined): boolean {
  if (!q) return false;
  return Object.keys(q).some(key => {
    const val = q[key as keyof FilterQuery];
    return val !== undefined && (Array.isArray(val) ? val.length > 0 : true);
  });
}

export function FilterBuilder({
  initialQuery,
  availablePatterns,
  availableStages,
  availableContinents,
  availableVerticals,
  taxonomyVerticals = [],
  taxonomySubVerticals = [],
  taxonomyLeaves = [],
  savedFilters,
  onFilterApply,
  onFilterSave,
  onFilterDelete,
  onFilterToggleAlerts,
  className = '',
}: FilterBuilderProps) {
  const [isExpanded, setIsExpanded] = useState(hasActiveFilters(initialQuery));
  const [query, setQuery] = useState<FilterQuery>(initialQuery || {});
  const [filterName, setFilterName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [showSaveInput, setShowSaveInput] = useState(false);

  // Sync internal state when parent's initialQuery changes
  useEffect(() => {
    const incoming = JSON.stringify(initialQuery || {});
    const current = JSON.stringify(query);
    if (incoming !== current) {
      setQuery(initialQuery || {});
      if (hasActiveFilters(initialQuery)) {
        setIsExpanded(true);
      }
    }
  }, [initialQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateQuery = useCallback((updates: Partial<FilterQuery>) => {
    const newQuery = { ...query, ...updates };
    setQuery(newQuery);
    onFilterApply(newQuery);
  }, [query, onFilterApply]);

  const clearFilter = useCallback((key: keyof FilterQuery, value?: string) => {
    if (value && Array.isArray(query[key])) {
      const arr = query[key] as string[];
      updateQuery({ [key]: arr.filter(v => v !== value) });
    } else {
      const newQuery = { ...query };
      delete newQuery[key];
      setQuery(newQuery);
      onFilterApply(newQuery);
    }
  }, [query, updateQuery, onFilterApply]);

  const clearAll = useCallback(() => {
    setQuery({});
    onFilterApply({});
  }, [onFilterApply]);

  const handleSave = useCallback(async () => {
    if (!filterName.trim()) return;
    setIsSaving(true);
    try {
      await onFilterSave(filterName.trim(), query, false);
      setFilterName('');
      setShowSaveInput(false);
    } finally {
      setIsSaving(false);
    }
  }, [filterName, query, onFilterSave]);

  const loadFilter = useCallback((filter: SavedFilter) => {
    setQuery(filter.query);
    onFilterApply(filter.query);
  }, [onFilterApply]);

  const taxonomyLabelFor = useCallback((id: string | undefined) => {
    if (!id) return undefined;
    const match =
      taxonomyLeaves.find(o => o.id === id) ||
      taxonomySubVerticals.find(o => o.id === id) ||
      taxonomyVerticals.find(o => o.id === id);
    return match?.label || id;
  }, [taxonomyLeaves, taxonomySubVerticals, taxonomyVerticals]);

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Filter Deals
          </CardTitle>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 hover:bg-muted/50 rounded transition-colors"
          >
            {isExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Active Filters */}
        <ActiveFilters query={query} onClear={clearFilter} onClearAll={clearAll} taxonomyLabelFor={taxonomyLabelFor} />

        {/* Saved Filters */}
        {savedFilters.length > 0 && (
          <div className="space-y-2">
            <label className="label-sm text-muted-foreground">Saved Filters</label>
            <div className="flex flex-wrap gap-2">
              {savedFilters.map(filter => (
                <div
                  key={filter.id}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-full border border-border/50 bg-muted/20"
                >
                  <button
                    onClick={() => loadFilter(filter)}
                    className="hover:text-accent-info transition-colors"
                  >
                    {filter.name}
                  </button>
                  <button
                    onClick={() => onFilterToggleAlerts(filter.id, !filter.alertsEnabled)}
                    className={`ml-1 ${filter.alertsEnabled ? 'text-accent-info' : 'text-muted-foreground'}`}
                    title={filter.alertsEnabled ? 'Alerts enabled' : 'Alerts disabled'}
                  >
                    {filter.alertsEnabled ? <Bell className="h-3 w-3" /> : <BellOff className="h-3 w-3" />}
                  </button>
                  <button
                    onClick={() => onFilterDelete(filter.id)}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Expanded Filter Options */}
        {isExpanded && (
          <div className="space-y-4 pt-2 border-t border-border/30">
            {/* Stage Filter */}
            <ChipSelect
              label="Stage"
              options={availableStages}
              selected={query.stages || []}
              onChange={(stages) => updateQuery({ stages })}
            />

            {/* Pattern Filter */}
            <ChipSelect
              label="Build Patterns"
              options={availablePatterns.slice(0, 10)}
              selected={query.patterns || []}
              onChange={(patterns) => updateQuery({ patterns })}
            />

            {/* Continent Filter */}
            <ChipSelect
              label="Region"
              options={availableContinents}
              selected={query.continents || []}
              onChange={(continents) => updateQuery({ continents })}
            />

            {/* Vertical Filter */}
            <ChipSelect
              label="Vertical"
              options={availableVerticals}
              selected={query.verticals || []}
              onChange={(verticals) => updateQuery({ verticals })}
            />

            {/* Taxonomy (preferred) */}
            {taxonomyVerticals.length > 0 && (
              <TaxonomySelect
                label="Industry (taxonomy)"
                value={query.verticalId}
                options={taxonomyVerticals}
                placeholder="Any industry"
                onChange={(verticalId) => updateQuery({ verticalId, subVerticalId: undefined, leafId: undefined })}
              />
            )}
            {query.verticalId && (
              <TaxonomySelect
                label="Sub-vertical (taxonomy)"
                value={query.subVerticalId}
                options={taxonomySubVerticals}
                placeholder={taxonomySubVerticals.length > 0 ? 'Any sub-vertical' : 'Pick an industry first'}
                onChange={(subVerticalId) => updateQuery({ subVerticalId, leafId: undefined })}
                disabled={taxonomySubVerticals.length === 0}
              />
            )}
            {query.subVerticalId && (
              <TaxonomySelect
                label="Category (taxonomy)"
                value={query.leafId}
                options={taxonomyLeaves}
                placeholder={taxonomyLeaves.length > 0 ? 'Any category' : 'Pick a sub-vertical first'}
                onChange={(leafId) => updateQuery({ leafId })}
                disabled={taxonomyLeaves.length === 0}
              />
            )}

            {/* Funding Range */}
            <FundingRange
              min={query.fundingMin}
              max={query.fundingMax}
              onMinChange={(fundingMin) => updateQuery({ fundingMin })}
              onMaxChange={(fundingMax) => updateQuery({ fundingMax })}
            />

            {/* GenAI Filter */}
            <div className="space-y-2">
              <label className="label-sm text-muted-foreground">GenAI</label>
              <div className="flex gap-2">
                {[
                  { label: 'All', value: undefined },
                  { label: 'Uses GenAI', value: true },
                  { label: 'Non-GenAI', value: false },
                ].map(option => (
                  <button
                    key={String(option.value)}
                    onClick={() => updateQuery({ usesGenai: option.value })}
                    className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                      query.usesGenai === option.value
                        ? 'bg-accent text-accent-foreground border-accent'
                        : 'bg-muted/30 text-muted-foreground border-border/50 hover:bg-muted/50'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Save Filter */}
            <div className="pt-2 border-t border-border/30">
              {showSaveInput ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={filterName}
                    onChange={(e) => setFilterName(e.target.value)}
                    placeholder="Filter name..."
                    className="flex-1"
                  />
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={!filterName.trim() || isSaving}
                  >
                    <Save className="h-4 w-4 mr-1" />
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setShowSaveInput(false);
                      setFilterName('');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowSaveInput(true)}
                  disabled={!hasActiveFilters(query)}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Save Current Filter
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
