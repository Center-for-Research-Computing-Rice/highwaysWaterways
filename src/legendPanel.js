import FeatureFilter from '@arcgis/core/layers/support/FeatureFilter.js';
import LegendViewModel from '@arcgis/core/widgets/Legend/LegendViewModel.js';
import { watch } from '@arcgis/core/core/reactiveUtils.js';
import FeatureEffect from '@arcgis/core/layers/support/FeatureEffect.js';
import { buildYearWhere, layerHasYearFields } from './yearFilter.js';

export const LEGEND_PRESENCE_EVENT = 'imaginehouston:legend-presence';

const FILTERABLE_LAYER_TYPES = new Set([
  'feature',
  'geo-json',
  'csv',
  'ogc-feature',
]);
const PRESENCE_CACHE_MAX = 320;

const EXCLUDED_EFFECT =
  'opacity(58%) grayscale(82%) saturate(55%) brightness(0.94)';
const INCLUDED_EFFECT =
  'brightness(103%) saturate(106%) drop-shadow(0px 1px 2px rgba(0, 0, 0, 0.52)) drop-shadow(0px 0 8px rgba(0, 0, 0, 0.42)) drop-shadow(0px 0 16px rgba(0, 0, 0, 0.26))';
const NO_MATCH_WHERE = '1 = 0';

function buildFilterableRowsSignature(container) {
  const parts = Array.from(
    container.querySelectorAll('.legend-panel__row--filterable'),
  )
    .map((row) => `${row.dataset.layerUid ?? ''}|${row.dataset.whereB64 ?? ''}`)
    .sort();
  return `${parts.length}:${parts.join(';')}`;
}

function normalizeKeyPart(value) {
  return value == null
    ? ''
    : typeof value == 'number' && Number.isFinite(value)
      ? String(value)
      : typeof value == 'boolean'
        ? value
          ? 'true'
          : 'false'
        : String(value).trim();
}

function buildGroupKey(attributes, fields) {
  return fields.map((field) => normalizeKeyPart(attributes[field])).join('|');
}

function buildGroupKeyFromValue(fields, delimiter, value) {
  if (fields.length <= 1) return normalizeKeyPart(value);
  const parts = (value == null ? '' : String(value)).split(delimiter);
  return fields.map((field, index) => normalizeKeyPart(parts[index])).join('|');
}

function supportsStatistics(layer) {
  const query = layer.capabilities?.query;
  return !!(query && query.supportsStatistics);
}

function readNumericAttribute(attributes, name) {
  if (!attributes) return 0;
  if (attributes[name] !== undefined && attributes[name] !== null) {
    const number = Number(attributes[name]);
    return Number.isFinite(number) ? number : 0;
  }
  const lowerName = name.toLowerCase();
  const matchingKey = Object.keys(attributes).find(
    (key) => key.toLowerCase() === lowerName,
  );
  if (matchingKey) {
    const number = Number(attributes[matchingKey]);
    return Number.isFinite(number) ? number : 0;
  }
  return 0;
}

function sqlLiteral(value) {
  return value == null
    ? 'NULL'
    : typeof value == 'number' && Number.isFinite(value)
      ? String(value)
      : typeof value == 'boolean'
        ? value
          ? '1'
          : '0'
        : `'${String(value).replace(/'/g, "''")}'`;
}

function buildWhereForLegendInfo(layer, info) {
  const renderer = layer.renderer;
  if (!renderer || renderer.valueExpression) return null;
  const rendererType = renderer.type;
  if (rendererType === 'heatmap') return null;
  if (rendererType === 'unique-value') {
    const field = renderer.field;
    if (!field) return null;
    const field2 = renderer.field2;
    const field3 = renderer.field3;
    const delimiter = renderer.fieldDelimiter ?? ',';
    const infoValue = info.value;
    if (infoValue == null) return null;
    if (field2) {
      const parts = String(infoValue).split(delimiter);
      const fieldNames = [field, field2, field3].filter(Boolean);
      const clauses = [];
      for (let index = 0; index < fieldNames.length; index++) {
        const part = parts[index];
        part === undefined ||
          part === '' ||
          clauses.push(`${fieldNames[index]} = ${sqlLiteral(part)}`);
      }
      return clauses.length ? clauses.join(' AND ') : null;
    }
    return `${field} = ${sqlLiteral(infoValue)}`;
  }
  if (rendererType === 'class-breaks') {
    const field = renderer.field;
    if (!field || renderer.normalizationType) return null;
    const infoValue = info.value;
    if (
      infoValue &&
      typeof infoValue == 'object' &&
      'minValue' in infoValue &&
      'maxValue' in infoValue
    ) {
      const minValue = infoValue.minValue;
      const maxValue = infoValue.maxValue;
      if (Number.isFinite(minValue) && Number.isFinite(maxValue))
        return `${field} >= ${minValue} AND ${field} <= ${maxValue}`;
    }
    const classBreakInfos = renderer.classBreakInfos;
    if (!classBreakInfos?.length) return null;
    const infoLabel = legendLabelToString(info.label);
    const matchingBreak = classBreakInfos.find(
      (classBreak) => legendLabelToString(classBreak.label) === infoLabel,
    );
    if (
      matchingBreak &&
      Number.isFinite(matchingBreak.minValue) &&
      Number.isFinite(matchingBreak.maxValue)
    )
      return `${field} >= ${matchingBreak.minValue} AND ${field} <= ${matchingBreak.maxValue}`;
    const numericValue =
      typeof infoValue == 'number' ? infoValue : Number(infoValue);
    if (Number.isFinite(numericValue)) {
      const containingBreak = classBreakInfos.find(
        (classBreak) =>
          numericValue >= classBreak.minValue &&
          numericValue <= classBreak.maxValue,
      );
      if (containingBreak)
        return `${field} >= ${containingBreak.minValue} AND ${field} <= ${containingBreak.maxValue}`;
    }
    return null;
  }
  return null;
}

function legendLabelToString(label) {
  return label == null || label === ''
    ? ''
    : typeof label == 'string'
      ? label
      : typeof label == 'object' && 'valueOf' in label
        ? String(label.valueOf())
        : String(label);
}

function renderLegendElement(element, parent, layer) {
  if (element) {
    if (element.type === 'symbol-table') {
      const title =
        typeof element.title == 'string' && element.title.trim()
          ? element.title
          : null;
      if (title) {
        const titleEl = document.createElement('div');
        titleEl.className = 'legend-panel__renderer-title';
        titleEl.textContent = title;
        parent.appendChild(titleEl);
      }
      for (const info of element.infos ?? []) {
        if (
          info &&
          typeof info == 'object' &&
          'type' in info &&
          info.type === 'symbol-table'
        ) {
          renderLegendElement(info, parent, layer);
          continue;
        }
        const row = document.createElement('div');
        row.className = 'legend-panel__row';
        const symbol = document.createElement('div');
        symbol.className = 'legend-panel__symbol';
        if ('preview' in info && info.preview instanceof HTMLElement) {
          const clone = info.preview.cloneNode(true);
          symbol.appendChild(clone);
        } else if ('src' in info && typeof info.src == 'string') {
          const img = document.createElement('img');
          img.className = 'legend-panel__symbol-img';
          img.src = info.src;
          img.alt = '';
          symbol.appendChild(img);
        }
        const label = document.createElement('div');
        label.className = 'legend-panel__row-label';
        label.textContent = legendLabelToString(
          'label' in info ? info.label : '',
        );
        row.appendChild(symbol);
        row.appendChild(label);
        const where = buildWhereForLegendInfo(layer, info);
        if (where && FILTERABLE_LAYER_TYPES.has(layer.type)) {
          const layerUid = String(layer.uid ?? layer.id ?? '');
          row.dataset.layerUid = layerUid;
          row.dataset.whereB64 = btoa(unescape(encodeURIComponent(where)));
          const renderer = layer.renderer;
          renderer?.type === 'unique-value'
            ? ((row.dataset.presKind = 'uv'),
              (row.dataset.presUvVal = btoa(
                unescape(encodeURIComponent(JSON.stringify(info.value))),
              )))
            : renderer?.type === 'class-breaks' &&
              (row.dataset.presKind = 'cb');
          row.classList.add('legend-panel__row--filterable');
          row.classList.add('legend-panel__row--interactive');
          row.setAttribute('role', 'button');
          row.tabIndex = 0;
        }
        parent.appendChild(row);
      }
      return;
    }
    if (
      new Set([
        'color-ramp',
        'stretch-ramp',
        'opacity-ramp',
        'size-ramp',
        'heatmap-ramp',
        'relationship-ramp',
        'univariate-color-size-ramp',
        'pie-chart-ramp',
      ]).has(element.type)
    ) {
      const note = document.createElement('div');
      note.className = 'legend-panel__ramp-note';
      note.textContent =
        (typeof element.title == 'string'
          ? element.title
          : element.type.replace(/-/g, ' ')) || 'Legend ramp';
      parent.appendChild(note);
    }
  }
}

function renderActiveLayerInfo(layerInfo, parent) {
  if (
    !layerInfo?.layer ||
    layerInfo.layer.visible === false ||
    ('legendEnabled' in layerInfo.layer &&
      layerInfo.layer.legendEnabled === false) ||
    !layerInfo.ready
  )
    return;
  if (layerInfo.children && layerInfo.children.length > 0) {
    const groupTitle = layerInfo.title || layerInfo.layer.title || 'Group';
    const section = document.createElement('section');
    section.className = 'legend-panel__group';
    const heading = document.createElement('h3');
    heading.className = 'legend-panel__group-title';
    heading.textContent = groupTitle;
    section.appendChild(heading);
    const rule = document.createElement('div');
    rule.className = 'legend-panel__rule';
    section.appendChild(rule);
    const body = document.createElement('div');
    body.className = 'legend-panel__group-body';
    layerInfo.children.forEach((child) => renderActiveLayerInfo(child, body));
    section.appendChild(body);
    body.childNodes.length > 0 && parent.appendChild(section);
    return;
  }
  const legendElements = layerInfo.legendElements;
  if (!legendElements?.length) return;
  const layerTitle = layerInfo.title || layerInfo.layer.title || 'Layer';
  const section = document.createElement('section');
  section.className = 'legend-panel__layer';
  const heading = document.createElement('h4');
  heading.className = 'legend-panel__layer-title';
  heading.textContent = layerTitle;
  section.appendChild(heading);
  const body = document.createElement('div');
  body.className = 'legend-panel__layer-body';
  for (const element of legendElements)
    renderLegendElement(element, body, layerInfo.layer);
  body.childNodes.length > 0 &&
    (section.appendChild(body), parent.appendChild(section));
}

function collectLayerInfoSignature(layerInfo, parts) {
  const layerKey = layerInfo.layer?.uid ?? layerInfo.layer?.id ?? '?';
  parts.push(`${layerKey}:${layerInfo.ready}:${layerInfo.version}`);
  layerInfo.children?.forEach?.((child) =>
    collectLayerInfoSignature(child, parts),
  );
}

function findLayerByUid(map, uid) {
  let found = null;
  map.allLayers.forEach((layer) => {
    !found && String(layer.uid ?? layer.id) === uid && (found = layer);
  });
  return found;
}

function clearFeatureEffects(view) {
  view.map.allLayers.forEach((layer) => {
    FILTERABLE_LAYER_TYPES.has(layer.type) &&
      view
        .whenLayerView(layer)
        .then((layerView) => {
          'featureEffect' in layerView && (layerView.featureEffect = null);
        })
        .catch(() => {});
  });
}

function applyFeatureEffect(view, targetLayer, where) {
  const promises = [];
  view.map.allLayers.forEach((layer) => {
    if (!FILTERABLE_LAYER_TYPES.has(layer.type)) return;
    const layerWhere = layer === targetLayer ? where : NO_MATCH_WHERE;
    promises.push(
      layer
        .load()
        .then(() => view.whenLayerView(layer))
        .then((layerView) => {
          if ('featureEffect' in layerView) {
            const isTarget = layer === targetLayer;
            layerView.featureEffect = new FeatureEffect({
              filter: new FeatureFilter({ where: layerWhere }),
              includedEffect: isTarget ? INCLUDED_EFFECT : 'none',
              excludedEffect: EXCLUDED_EFFECT,
            });
          }
        })
        .catch(() => {}),
    );
  });
  return Promise.all(promises);
}

function clearSelectedRows(container) {
  container.querySelectorAll('.legend-panel__row--selected').forEach((row) => {
    row.classList.remove('legend-panel__row--selected');
  });
}

/**
 * Creates the custom legend panel inside `container` and returns a cleanup function.
 */
export function createLegendPanel(view, container, options = {}) {
  const getSliderYear =
    typeof options.getSliderYear == 'function'
      ? options.getSliderYear
      : () => 2000;
  const legendViewModel = new LegendViewModel({
    view,
    basemapLegendVisible: false,
    respectLayerVisibility: true,
  });
  let selection = null;
  let presenceRunId = 0;
  let lastFilterableSignature = null;
  const presenceCache = new Map();

  function cacheGet(key) {
    return presenceCache.get(key);
  }

  function cacheSet(key, value) {
    presenceCache.size >= PRESENCE_CACHE_MAX && presenceCache.clear();
    presenceCache.set(key, value);
  }

  function applyCachedPresence(year) {
    const rows = Array.from(
      container.querySelectorAll('.legend-panel__row--filterable'),
    );
    for (const row of rows) {
      const layerUid = row.dataset.layerUid;
      const whereB64 = row.dataset.whereB64;
      if (!layerUid || !whereB64) continue;
      let where;
      try {
        where = decodeURIComponent(escape(atob(whereB64)));
      } catch {
        continue;
      }
      const layer = findLayerByUid(view.map, layerUid);
      if (!layer) continue;
      let fullWhere = where;
      if (layerHasYearFields(layer)) {
        const yearWhere = buildYearWhere(year);
        yearWhere && (fullWhere = `(${yearWhere}) AND (${where})`);
      }
      const present = cacheGet(
        `${String(layer.uid ?? layer.id)}|${year}|${fullWhere}`,
      );
      present !== undefined &&
        (present
          ? row.classList.remove('legend-panel__row--absent')
          : row.classList.add('legend-panel__row--absent'));
    }
  }

  async function updateRowPresence(row, layer, year, runId) {
    const whereB64 = row.dataset.whereB64;
    if (!whereB64) return;
    let where;
    try {
      where = decodeURIComponent(escape(atob(whereB64)));
    } catch {
      return;
    }
    let fullWhere = where;
    if (layerHasYearFields(layer)) {
      const yearWhere = buildYearWhere(year);
      yearWhere && (fullWhere = `(${yearWhere}) AND (${where})`);
    }
    if (typeof layer.queryFeatures != 'function') return;
    const cacheKey = `${String(layer.uid ?? layer.id)}|${year}|${fullWhere}`;
    let present = cacheGet(cacheKey);
    if (present === undefined)
      try {
        const query = layer.createQuery();
        query.where = fullWhere;
        query.num = 1;
        query.returnGeometry = false;
        const objectIdField =
          'objectIdField' in layer && typeof layer.objectIdField == 'string'
            ? layer.objectIdField
            : null;
        query.outFields = objectIdField ? [objectIdField] : ['*'];
        present =
          ((await layer.queryFeatures(query)).features?.length ?? 0) > 0;
        runId === presenceRunId && cacheSet(cacheKey, present);
      } catch {
        if (runId !== presenceRunId) return;
        row.classList.remove('legend-panel__row--absent');
        return;
      }
    runId === presenceRunId &&
      (present
        ? row.classList.remove('legend-panel__row--absent')
        : row.classList.add('legend-panel__row--absent'));
  }

  async function updateUniqueValuePresence(layer, rows, year, runId) {
    const renderer = layer.renderer;
    if (
      !renderer ||
      renderer.type !== 'unique-value' ||
      !supportsStatistics(layer)
    )
      return false;
    const field = renderer.field;
    if (!field) return false;
    const groupFields = [field, renderer.field2, renderer.field3].filter(
      Boolean,
    );
    let baseWhere = '1=1';
    if (layerHasYearFields(layer)) {
      const yearWhere = buildYearWhere(year);
      yearWhere && (baseWhere = yearWhere);
    }
    const objectIdField =
      'objectIdField' in layer && typeof layer.objectIdField == 'string'
        ? layer.objectIdField
        : null;
    if (!objectIdField) return false;
    const countFieldName = 'presence_cnt';
    try {
      const query = layer.createQuery();
      query.where = baseWhere;
      query.returnGeometry = false;
      query.outStatistics = [
        {
          statisticType: 'count',
          onStatisticField: objectIdField,
          outStatisticFieldName: countFieldName,
        },
      ];
      query.groupByFieldsForStatistics = groupFields;
      const result = await layer.queryFeatures(query);
      if (runId !== presenceRunId) return true;
      const counts = new Map();
      for (const feature of result.features ?? []) {
        const attributes = feature.attributes;
        if (!attributes) continue;
        const attrs = attributes;
        const key = buildGroupKey(attrs, groupFields);
        const count = readNumericAttribute(attrs, countFieldName);
        counts.set(key, (counts.get(key) ?? 0) + count);
      }
      const delimiter = renderer.fieldDelimiter ?? ',';
      for (const row of rows) {
        let infoValue;
        try {
          const encodedValue = row.dataset.presUvVal;
          if (!encodedValue) throw Error();
          infoValue = JSON.parse(
            decodeURIComponent(escape(atob(encodedValue))),
          );
        } catch {
          row.classList.remove('legend-panel__row--absent');
          continue;
        }
        const groupKey = buildGroupKeyFromValue(
          groupFields,
          delimiter,
          infoValue,
        );
        const present = (counts.get(groupKey) ?? 0) > 0;
        const whereB64 = row.dataset.whereB64;
        if (whereB64 && runId === presenceRunId)
          try {
            const where = decodeURIComponent(escape(atob(whereB64)));
            let fullWhere = where;
            if (layerHasYearFields(layer)) {
              const yearWhere = buildYearWhere(year);
              yearWhere && (fullWhere = `(${yearWhere}) AND (${where})`);
            }
            cacheSet(
              `${String(layer.uid ?? layer.id)}|${year}|${fullWhere}`,
              present,
            );
          } catch {}
        if (runId !== presenceRunId) return true;
        present
          ? row.classList.remove('legend-panel__row--absent')
          : row.classList.add('legend-panel__row--absent');
      }
      return true;
    } catch {
      return false;
    }
  }

  async function updateLayerPresence(layerUid, rows, year, runId) {
    const layer = findLayerByUid(view.map, layerUid);
    if (!layer || typeof layer.queryFeatures != 'function') return;
    const uniqueValueRows = rows.filter((row) => row.dataset.presKind === 'uv');
    const otherRows = rows.filter((row) => row.dataset.presKind !== 'uv');
    let uniqueValueHandled = false;
    uniqueValueRows.length > 0 &&
      (uniqueValueHandled = await updateUniqueValuePresence(
        layer,
        uniqueValueRows,
        year,
        runId,
      ));
    const fallbackRows = [];
    uniqueValueRows.length > 0 &&
      !uniqueValueHandled &&
      fallbackRows.push(...uniqueValueRows);
    fallbackRows.push(...otherRows);
    await Promise.all(
      fallbackRows.map((row) => updateRowPresence(row, layer, year, runId)),
    );
  }

  async function refreshPresence(year) {
    const runId = ++presenceRunId;
    const rows = Array.from(
      container.querySelectorAll('.legend-panel__row--filterable'),
    );
    const layers = new Map();
    for (const row of rows) {
      const layerUid = row.dataset.layerUid;
      if (!layerUid) continue;
      const layer = findLayerByUid(view.map, layerUid);
      layer &&
        typeof layer.queryFeatures == 'function' &&
        layers.set(String(layer.uid ?? layer.id), layer);
    }
    if (
      (await Promise.all(
        [...layers.values()].map((layer) => layer.load().catch(() => {})),
      ),
      runId !== presenceRunId)
    )
      return;
    const rowsByLayer = new Map();
    for (const row of rows) {
      const layerUid = row.dataset.layerUid;
      layerUid &&
        (rowsByLayer.has(layerUid) || rowsByLayer.set(layerUid, []),
        rowsByLayer.get(layerUid).push(row));
    }
    (await Promise.all(
      [...rowsByLayer.entries()].map(([layerUid, layerRows]) =>
        updateLayerPresence(layerUid, layerRows, year, runId),
      ),
    ),
      runId === presenceRunId &&
        container
          .querySelector('.legend-panel__row--selected')
          ?.classList.contains('legend-panel__row--absent') &&
        ((selection = null),
        clearSelectedRows(container),
        clearFeatureEffects(view)));
  }

  function onYearEvent(event) {
    refreshPresence(event.detail?.year ?? getSliderYear());
  }

  function restoreSelection() {
    if (!selection) return;
    const { layerUid, where } = selection;
    const whereB64 = btoa(unescape(encodeURIComponent(where)));
    const row = container.querySelector(
      `.legend-panel__row--interactive[data-layer-uid="${CSS.escape(layerUid)}"][data-where-b64="${CSS.escape(whereB64)}"]`,
    );
    row && row.classList.add('legend-panel__row--selected');
    const layer = findLayerByUid(view.map, layerUid);
    layer ? applyFeatureEffect(view, layer, where) : (selection = null);
  }

  function onContainerClick(event) {
    const row = event.target.closest('.legend-panel__row--interactive');
    if (!row || !container.contains(row)) return;
    const layerUid = row.dataset.layerUid;
    const whereB64 = row.dataset.whereB64;
    if (!layerUid || !whereB64) return;
    let where;
    try {
      where = decodeURIComponent(escape(atob(whereB64)));
    } catch {
      return;
    }
    const layer = findLayerByUid(view.map, layerUid);
    if (!layer) return;
    const isSameSelection =
      selection && selection.layerUid === layerUid && selection.where === where;
    if (
      (clearSelectedRows(container), clearFeatureEffects(view), isSameSelection)
    ) {
      selection = null;
      return;
    }
    selection = { layerUid, where };
    row.classList.add('legend-panel__row--selected');
    applyFeatureEffect(view, layer, where);
  }

  function onContainerKeydown(event) {
    if (
      (event.key !== 'Enter' && event.key !== ' ') ||
      !(event.target instanceof Element)
    )
      return;
    const row = event.target.closest('.legend-panel__row--interactive');
    !row ||
      !container.contains(row) ||
      (event.preventDefault(),
      row.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      ));
  }

  container.addEventListener('click', onContainerClick);
  container.addEventListener('keydown', onContainerKeydown);
  window.addEventListener(LEGEND_PRESENCE_EVENT, onYearEvent);

  function renderLegend() {
    container.replaceChildren();
    const fragment = document.createDocumentFragment();
    if (
      (legendViewModel.activeLayerInfos.forEach((layerInfo) =>
        renderActiveLayerInfo(layerInfo, fragment),
      ),
      !fragment.childNodes.length)
    ) {
      const empty = document.createElement('p');
      empty.className = 'legend-panel__empty';
      empty.textContent = 'No legend for visible layers.';
      fragment.appendChild(empty);
    }
    container.appendChild(fragment);
    restoreSelection();
    applyCachedPresence(getSliderYear());
    const filterableCount = container.querySelectorAll(
      '.legend-panel__row--filterable',
    ).length;
    const signature = buildFilterableRowsSignature(container);
    if (
      (filterableCount === 0 && (lastFilterableSignature = null),
      filterableCount > 0 && signature !== lastFilterableSignature)
    ) {
      lastFilterableSignature = signature;
      const year = getSliderYear();
      queueMicrotask(() => {
        refreshPresence(year);
      });
    }
  }

  const activeLayerInfosHandle = legendViewModel.activeLayerInfos.on(
    'change',
    () => {
      queueMicrotask(renderLegend);
    },
  );
  const activeLayerInfosWatch = watch(
    () => {
      const parts = [];
      legendViewModel.activeLayerInfos.forEach((layerInfo) =>
        collectLayerInfoSignature(layerInfo, parts),
      );
      return parts.join('|');
    },
    () => {
      renderLegend();
    },
  );

  renderLegend();

  return () => {
    presenceCache.clear();
    window.removeEventListener(LEGEND_PRESENCE_EVENT, onYearEvent);
    container.removeEventListener('click', onContainerClick);
    container.removeEventListener('keydown', onContainerKeydown);
    activeLayerInfosHandle.remove();
    activeLayerInfosWatch.remove();
    selection = null;
    clearFeatureEffects(view);
    typeof legendViewModel.destroy == 'function' && legendViewModel.destroy();
  };
}
