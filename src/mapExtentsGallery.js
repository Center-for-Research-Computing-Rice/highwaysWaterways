import WebTileLayer from '@arcgis/core/layers/WebTileLayer.js';

export const MAP_EXTENTS_LAYER_TITLE = 'MapExtentsPoly';
const IMAGE_BASE =
  'https://highwayswaterways-images.s3.us-east-1.amazonaws.com';
const RASTER_BASE =
  'https://highwayswaterways-raster.s3.us-east-1.amazonaws.com';

function thumbUrl(imageId) {
  return imageId == null || imageId === ''
    ? ''
    : `${IMAGE_BASE}/${encodeURIComponent(String(imageId))}/thumb.jpg`;
}

function mediumUrl(imageId) {
  return imageId == null || imageId === ''
    ? ''
    : `${IMAGE_BASE}/${encodeURIComponent(String(imageId))}/medium.jpg`;
}

function rasterTemplateUrl(mapId) {
  return mapId == null || mapId === ''
    ? ''
    : `${RASTER_BASE}/${encodeURIComponent(String(mapId))}/{level}/{col}/{row}.png`;
}

function findFieldName(layer, ...candidates) {
  const fields = layer.fields;
  if (!fields?.length) return null;
  const byLowerName = new Map(
    fields.map((field) => [field.name.toLowerCase(), field.name]),
  );
  for (const candidate of candidates) {
    const match = byLowerName.get(candidate.toLowerCase());
    if (match) return match;
  }
  return null;
}

function detectYearFields(layer) {
  const fields = layer.fields ?? [];
  let fyField = findFieldName(
    layer,
    'firstyear',
    'FirstYear',
    'first_year',
    'First_Year',
    'FIRSTYEAR',
    'startyear',
    'StartYear',
    'start_year',
    'Start_Year',
    'fy',
    'FY',
  );
  let lyField = findFieldName(
    layer,
    'lastyear',
    'LastYear',
    'last_year',
    'Last_Year',
    'LASTYEAR',
    'endyear',
    'EndYear',
    'end_year',
    'End_Year',
    'ly',
    'LY',
  );
  if (!fyField) {
    const match = fields.find((field) => {
      const name = field.name.toLowerCase();
      return (
        (name.includes('first') ||
          name.includes('start') ||
          name.includes('begin')) &&
        (name.includes('year') || name === 'fy')
      );
    });
    match && (fyField = match.name);
  }
  if (!lyField) {
    const match = fields.find((field) => {
      const name = field.name.toLowerCase();
      return (
        (name.includes('last') || name.includes('end')) &&
        (name.includes('year') || name === 'ly')
      );
    });
    match && (lyField = match.name);
  }
  return { fyField, lyField };
}

function detectTitleField(layer) {
  return (
    findFieldName(
      layer,
      'title',
      'Title',
      'name',
      'Name',
      'caption',
      'Caption',
      'label',
      'Label',
    ) ||
    ((layer.fields ?? []).find((field) =>
      /title|name|caption|label/i.test(field.name),
    )?.name ??
      null)
  );
}

function detectCreatorField(layer) {
  return (
    findFieldName(
      layer,
      'creator',
      'Creator',
      'createdby',
      'CreatedBy',
      'created_by',
      'Created_By',
      'author',
      'Author',
      'publisher',
      'Publisher',
    ) ||
    ((layer.fields ?? []).find((field) =>
      /creator|createdby|author|publisher/i.test(field.name),
    )?.name ??
      null)
  );
}

function detectImageField(layer) {
  const field = findFieldName(
    layer,
    'imageid',
    'ImageID',
    'IMAGEID',
    'IMAGE_ID',
    'image_id',
    'ImgID',
    'IMGID',
    'mapid',
    'MapID',
    'tileid',
    'TileID',
    'id',
    'Id',
    'ID',
  );
  if (field) return field;
  for (const layerField of layer.fields ?? []) {
    const name = layerField.name.toLowerCase().replace(/_/g, '');
    if (
      (name.includes('image') && name.includes('id')) ||
      (name.includes('tile') && name.includes('id')) ||
      name === 'mapid'
    )
      return layerField.name;
  }
  return null;
}

function detectFields(layer) {
  const { fyField, lyField } = detectYearFields(layer);
  return {
    fyField,
    lyField,
    imgF: detectImageField(layer),
    titleF: detectTitleField(layer),
    creatorF: detectCreatorField(layer),
  };
}

function buildLayerWhere(fields, year) {
  const fyField = fields.fyField;
  const lyField = fields.lyField;
  if (!fyField || !lyField) return null;
  const parsed = Number.parseInt(String(year), 10);
  return Number.isFinite(parsed)
    ? `${fyField} <= ${parsed} AND ${lyField} >= ${parsed}`
    : null;
}

function featurePassesYear(fields, attributes, year) {
  const fyField = fields.fyField;
  const lyField = fields.lyField;
  if (!fyField || !lyField) return true;
  const firstYear = Number(attributes[fyField]);
  const lastYear = Number(attributes[lyField]);
  return !Number.isFinite(firstYear) || !Number.isFinite(lastYear)
    ? true
    : firstYear <= year && lastYear >= year;
}

async function queryMapExtents(layer, fields, year) {
  const where = buildLayerWhere(fields, year);
  const runQuery = async (whereClause) => {
    const query = layer.createQuery();
    query.where = whereClause;
    query.outFields = ['*'];
    query.returnGeometry = true;
    query.num = 2000;
    return layer.queryFeatures(query);
  };
  let result = await runQuery(where ?? '1=1');
  let features = result.features ?? [];
  if (features.length === 0 && where) {
    result = await runQuery('1=1');
    features = (result.features ?? []).filter((feature) =>
      featurePassesYear(fields, feature.attributes ?? {}, year),
    );
  }
  return features;
}

function toKey(value) {
  return String(value ?? '');
}

function isMapExtentsLayer(layer) {
  return layer.type === 'feature'
    ? String(layer.title ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '') === MAP_EXTENTS_LAYER_TITLE.toLowerCase() ||
        String(layer.id ?? '')
          .toLowerCase()
          .replace(/\s+/g, '') === MAP_EXTENTS_LAYER_TITLE.toLowerCase()
    : false;
}

function findMapExtentsLayer(map) {
  let found = null;
  map.allLayers.forEach((layer) => {
    found || (isMapExtentsLayer(layer) && (found = layer));
  });
  return found;
}

async function waitForMapExtentsLayer(map) {
  await map.load().catch(() => {});
  for (let attempt = 0; attempt < 60; attempt++) {
    const layer = findMapExtentsLayer(map);
    if (layer) return (await layer.load().catch(() => {}), layer);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

/**
 * Historical maps gallery backed by the MapExtentsPoly layer; selected maps
 * are shown as a WebTileLayer. Returns `{ refresh(year), destroy() }`.
 */
export async function createMapExtentsGallery(view, map, options) {
  const {
    galleryEl,
    getYear,
    mapPreviewEl,
    mapPreviewTitleEl,
    mapPreviewImgEl,
    mapPreviewCloseBtn,
    mapOpacityRangeEl,
    mapOpacityValueEl,
  } = options;
  let selectedMapId = null;
  let selectedMapTitle = '';
  let mapOpacity = 0.9;

  function syncOpacityControl() {
    if (!mapOpacityRangeEl) return;
    const percent = Math.round((1 - mapOpacity) * 100);
    mapOpacityRangeEl.value = String(Math.max(0, Math.min(90, percent)));
    mapOpacityValueEl && (mapOpacityValueEl.textContent = `${percent}%`);
  }

  function syncMapPreview() {
    if (!mapPreviewEl || !mapPreviewImgEl) return;
    if (!selectedMapId) {
      mapPreviewEl.hidden = true;
      mapPreviewImgEl.removeAttribute('src');
      mapPreviewTitleEl && (mapPreviewTitleEl.textContent = '');
      return;
    }
    mapPreviewEl.hidden = false;
    const title = selectedMapTitle?.trim() || `Historical map ${selectedMapId}`;
    mapPreviewTitleEl && (mapPreviewTitleEl.textContent = title);
    mapPreviewImgEl.alt = title;
    mapPreviewImgEl.src = mediumUrl(selectedMapId);
    syncOpacityControl();
  }

  function hideMapPreview() {
    mapPreviewEl && (mapPreviewEl.hidden = true);
    mapPreviewImgEl && mapPreviewImgEl.removeAttribute('src');
    mapPreviewTitleEl && (mapPreviewTitleEl.textContent = '');
  }

  function setGalleryVisible(visible) {
    const gallery = galleryEl.closest('.hist-gallery');
    gallery instanceof HTMLElement && (gallery.hidden = !visible);
  }

  function setSelectedTile(mapId) {
    selectedMapId = mapId;
    galleryEl.querySelectorAll('.hist-gallery__tile--map').forEach((tile) => {
      if (!(tile instanceof HTMLElement)) return;
      const tileMapId = tile.dataset.mapId ?? '';
      const selected = !!mapId && tileMapId === mapId;
      tile.classList.toggle('hist-gallery__tile--selected', selected);
      tile.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
  }

  function setGalleryRows(count) {
    const gallery = galleryEl.closest('.hist-gallery');
    if (!(gallery instanceof HTMLElement)) return;
    if (count <= 0) {
      gallery.style.setProperty('--hg-rows', '0');
      gallery.style.setProperty('--hg-viewport-h', '0px');
      return;
    }
    gallery.style.removeProperty('--hg-viewport-h');
    const rows = Math.max(1, Math.min(3, Math.ceil(count / 3)));
    gallery.style.setProperty('--hg-rows', String(rows));
  }

  let mapExtentsLayer = null;
  let tileLayer = null;
  let refreshRunId = 0;

  function removeTileLayer() {
    tileLayer &&=
      (map.remove(tileLayer),
      typeof tileLayer.destroy == 'function' && tileLayer.destroy(),
      null);
  }

  function clearSelection() {
    removeTileLayer();
    selectedMapId = null;
    selectedMapTitle = '';
    setSelectedTile(null);
    hideMapPreview();
  }

  async function showMapTiles(mapId, geometry, title) {
    removeTileLayer();
    const urlTemplate = rasterTemplateUrl(mapId);
    if (!urlTemplate) return;
    const layer = new (WebTileLayer.createSubclass({
      getTileUrl(level, row, col) {
        const flippedRow = 2 ** level - 1 - row;
        return urlTemplate
          .replace('{level}', String(level))
          .replace('{col}', String(col))
          .replace('{row}', String(flippedRow));
      },
    }))({
      title: title || `Historical map ${mapId}`,
      urlTemplate,
      opacity: mapOpacity,
      visible: true,
    });
    if (((tileLayer = layer), map.add(layer), geometry))
      try {
        await view.goTo(geometry, {
          animate: true,
          animationMode: 'always',
          duration: 1200,
          easing: 'cubic-in-out',
        });
      } catch {}
  }

  async function refresh(year) {
    const runId = ++refreshRunId;
    const layer = mapExtentsLayer ?? (await waitForMapExtentsLayer(map));
    if (runId !== refreshRunId) return;
    if (!layer) {
      setGalleryVisible(true);
      galleryEl.replaceChildren();
      const message = document.createElement('p');
      message.className = 'hist-gallery__empty';
      message.textContent = 'Map extents layer was not found in the map.';
      galleryEl.appendChild(message);
      return;
    }
    mapExtentsLayer = layer;
    const fields = detectFields(layer);
    if (!fields.imgF) {
      setGalleryVisible(true);
      galleryEl.replaceChildren();
      const message = document.createElement('p');
      message.className = 'hist-gallery__empty';
      message.textContent =
        'Could not find an image id field on MapExtentsPoly (expected something like imageid).';
      galleryEl.appendChild(message);
      return;
    }
    let features = [];
    try {
      features = await queryMapExtents(layer, fields, year);
    } catch {
      if (runId !== refreshRunId) return;
      setGalleryVisible(true);
      galleryEl.replaceChildren();
      const message = document.createElement('p');
      message.className = 'hist-gallery__empty';
      message.textContent = 'Could not load historical maps.';
      galleryEl.appendChild(message);
      return;
    }
    if (runId !== refreshRunId) return;
    const seenMapIds = new Map();
    const tiles = [];
    for (const feature of features) {
      const attributes = feature.attributes ?? {};
      const mapId = toKey(fields.imgF ? attributes[fields.imgF] : undefined);
      if (!mapId || seenMapIds.has(mapId)) continue;
      seenMapIds.set(mapId, feature);
      const mapTitle =
        fields.titleF && attributes[fields.titleF] != null
          ? String(attributes[fields.titleF])
          : 'Untitled map';
      const creator =
        fields.creatorF && attributes[fields.creatorF] != null
          ? String(attributes[fields.creatorF])
          : '';
      const label = creator ? `${mapTitle} — ${creator}` : mapTitle;
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'hist-gallery__tile hist-gallery__tile--map';
      tile.dataset.mapId = mapId;
      tile.setAttribute('aria-pressed', 'false');
      tile.setAttribute('aria-label', `Show map: ${label}`);
      const thumb = document.createElement('img');
      thumb.className = 'hist-gallery__thumb';
      thumb.draggable = false;
      thumb.loading = 'lazy';
      thumb.alt = '';
      thumb.src = thumbUrl(mapId);
      tile.appendChild(thumb);
      tile.addEventListener('click', async () => {
        if (selectedMapId === mapId) {
          clearSelection();
          return;
        }
        selectedMapId = mapId;
        selectedMapTitle = mapTitle;
        setSelectedTile(mapId);
        syncMapPreview();
        await showMapTiles(
          mapId,
          seenMapIds.get(mapId)?.geometry ?? null,
          mapTitle,
        );
      });
      tiles.push(tile);
    }
    if (
      (selectedMapId && !seenMapIds.has(selectedMapId) && clearSelection(),
      seenMapIds.size === 0)
    ) {
      setGalleryRows(0);
      setGalleryVisible(false);
      galleryEl.replaceChildren();
      return;
    }
    setGalleryRows(seenMapIds.size);
    setGalleryVisible(true);
    galleryEl.replaceChildren(...tiles);
    setSelectedTile(selectedMapId);
  }

  await refresh(getYear());
  const listenerAbortController = new AbortController();
  (mapPreviewCloseBtn?.addEventListener(
    'click',
    () => {
      clearSelection();
    },
    { signal: listenerAbortController.signal },
  ),
    mapOpacityRangeEl?.addEventListener(
      'input',
      () => {
        const percent = Number(mapOpacityRangeEl.value);
        mapOpacity =
          1 -
          (Number.isFinite(percent) ? Math.max(0, Math.min(90, percent)) : 10) /
            100;
        tileLayer && (tileLayer.opacity = mapOpacity);
        syncOpacityControl();
      },
      { signal: listenerAbortController.signal },
    ));

  function destroy() {
    refreshRunId += 1;
    listenerAbortController.abort();
    clearSelection();
    galleryEl.replaceChildren();
  }

  return {
    refresh: (year) => refresh(typeof year == 'number' ? year : getYear()),
    destroy,
  };
}
