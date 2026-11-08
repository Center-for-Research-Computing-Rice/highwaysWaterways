import Graphic from '@arcgis/core/Graphic.js';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer.js';
import Point from '@arcgis/core/geometry/Point.js';
import SimpleFillSymbol from '@arcgis/core/symbols/SimpleFillSymbol.js';
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol.js';

export const VIEW_CONES_LAYER_TITLE = 'ViewConesPoly';
const IMAGE_BASE =
  'https://highwayswaterways-images.s3.us-east-1.amazonaws.com';

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

function fullUrl(imageId) {
  return imageId == null || imageId === ''
    ? ''
    : `${IMAGE_BASE}/${encodeURIComponent(String(imageId))}/full.jpg`;
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
  const fields = layer.fields ?? [];
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

function detectImageField(layer) {
  const field = findFieldName(
    layer,
    'imageid',
    'ImageID',
    'IMAGEID',
    'IMAGE_ID',
    'image_id',
    'Image_Id',
    'ImgID',
    'img_id',
    'IMGID',
    'photo_id',
    'PhotoID',
    'photoid',
    'PictureID',
    'picture_id',
    'ImageUrlId',
  );
  if (field) return field;
  for (const layerField of layer.fields ?? []) {
    const name = layerField.name.toLowerCase().replace(/_/g, '');
    if (
      (name.includes('image') && name.includes('id')) ||
      name === 'imgid' ||
      name === 'photoid'
    )
      return layerField.name;
  }
  return null;
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

function detectFields(layer) {
  const { fyField, lyField } = detectYearFields(layer);
  return {
    fyField,
    lyField,
    latF: findFieldName(layer, 'latitude', 'Latitude', 'lat', 'LAT', 'Lat'),
    lonF: findFieldName(
      layer,
      'longitude',
      'Longitude',
      'lon',
      'lng',
      'long',
      'Lon',
    ),
    imgF: detectImageField(layer),
    titleF: detectTitleField(layer),
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

async function queryViewCones(layer, fields, year) {
  const where = buildLayerWhere(fields, year);
  const runQuery = async (whereClause) => {
    const query = layer.createQuery();
    query.where = whereClause;
    query.outFields = ['*'];
    query.returnGeometry = true;
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

function isViewConesLayer(layer) {
  if (layer.type !== 'feature') return false;
  const title = String(layer.title ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
  if (
    title === VIEW_CONES_LAYER_TITLE.toLowerCase() ||
    (title.includes('viewcone') && title.includes('poly'))
  )
    return true;
  const id = String(layer.id ?? '')
    .toLowerCase()
    .replace(/\s+/g, '');
  return !!(id.includes('viewcone') && id.includes('poly'));
}

function findViewConesLayer(map) {
  let found = null;
  map.allLayers.forEach((layer) => {
    found || (isViewConesLayer(layer) && (found = layer));
  });
  return found;
}

async function waitForViewConesLayer(map) {
  await map.load().catch(() => {});
  for (let attempt = 0; attempt < 60; attempt++) {
    const layer = findViewConesLayer(map);
    if (layer) return (await layer.load().catch(() => {}), layer);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

function readLatLon(attributes, latField, lonField) {
  if (!latField || !lonField) return null;
  const lat = Number(attributes[latField]);
  const lon = Number(attributes[lonField]);
  return !Number.isFinite(lat) || !Number.isFinite(lon) ? null : { lat, lon };
}

function toKey(value) {
  return String(value ?? '');
}

/**
 * Historical views gallery backed by the ViewConesPoly layer.
 * Returns `{ refresh(year), destroy() }`.
 */
export async function createViewConesGallery(view, map, options) {
  const {
    galleryEl,
    getYear,
    mapPreviewEl,
    mapPreviewTitleEl,
    mapPreviewImgEl,
    mapPreviewExpandBtn,
    mapPreviewPrevBtn,
    mapPreviewNextBtn,
    viewImageLightbox,
    viewImageLightboxTitleEl,
    viewImageLightboxImg,
    viewImageLightboxCloseBtn,
    viewImageLightboxPrevBtn,
    viewImageLightboxNextBtn,
  } = options;

  function setGalleryVisible(visible) {
    const gallery = galleryEl.closest('.hist-gallery');
    gallery instanceof HTMLElement && (gallery.hidden = !visible);
  }

  let selectedImageId = null;

  function setSelectedTile(imageId) {
    selectedImageId = imageId;
    galleryEl.querySelectorAll('.hist-gallery__tile').forEach((tile) => {
      if (!(tile instanceof HTMLElement)) return;
      const tileImageId = tile.dataset.imageId ?? '';
      const selected = !!imageId && tileImageId === imageId;
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

  let previewTitle = '';
  let previewImageId = '';
  const coneGraphicsLayer = new GraphicsLayer({
    title: 'View cones (graphics)',
    listMode: 'hide',
  });
  const markerGraphicsLayer = new GraphicsLayer({
    title: 'View cone markers',
    listMode: 'hide',
  });
  map.add(coneGraphicsLayer);
  map.add(markerGraphicsLayer);
  const coneSymbol = new SimpleFillSymbol({
    color: [125, 143, 163, 0.22],
    outline: { color: [125, 143, 163, 0.9], width: 1 },
  });
  const hoverPopup = document.createElement('div');
  hoverPopup.className = 'view-cone-hover-popup';
  hoverPopup.setAttribute('role', 'tooltip');
  hoverPopup.hidden = true;
  hoverPopup.innerHTML =
    '<div class="view-cone-hover-popup__inner"><img class="view-cone-hover-popup__img" alt="" /><div class="view-cone-hover-popup__title"></div></div>';
  document.body.appendChild(hoverPopup);
  const hoverPopupImg = hoverPopup.querySelector('.view-cone-hover-popup__img');
  const hoverPopupTitle = hoverPopup.querySelector(
    '.view-cone-hover-popup__title',
  );
  hoverPopupImg instanceof HTMLImageElement &&
    (hoverPopupImg.draggable = false);

  let viewConesLayer = null;
  let coneGraphicsLayerView = null;
  let layerFields = null;
  const coneRecords = new Map();
  let activeImageId = null;
  const imageIds = [];
  let refreshRunId = 0;
  let pointerMoveHandle = null;
  let clickHandle = null;
  let mouseLeaveHandler = null;
  const markerSymbol = new SimpleMarkerSymbol({
    style: 'circle',
    color: [125, 143, 163, 0.92],
    size: 9,
    outline: { color: [255, 255, 255, 0.95], width: 1 },
  });
  let hoverTimer = null;
  let lastPointerEvent = null;
  let lastHoverScreenPoint = { x: 0, y: 0 };
  let hoverRunId = 0;
  let hoveredGraphic = null;
  let hoverPopupImageKey = '';
  let markerConeKey = null;

  function hideHoverPopup() {
    hoverPopup.hidden = true;
    hoveredGraphic = null;
    hoverPopupImageKey = '';
    markerConeKey = null;
  }

  function closeLightbox() {
    viewImageLightbox?.open && viewImageLightbox.close();
  }

  function clearLightbox() {
    viewImageLightboxImg && viewImageLightboxImg.removeAttribute('src');
    viewImageLightboxTitleEl && (viewImageLightboxTitleEl.textContent = '');
  }

  function clearMapPreview() {
    closeLightbox();
    previewTitle = '';
    previewImageId = '';
    mapPreviewEl && (mapPreviewEl.hidden = true);
    mapPreviewImgEl && mapPreviewImgEl.removeAttribute('src');
    mapPreviewTitleEl && (mapPreviewTitleEl.textContent = '');
    updatePreviewNavButtons();
  }

  function syncLightbox() {
    if (!viewImageLightbox?.open || !previewImageId || !viewImageLightboxImg)
      return;
    const url = fullUrl(previewImageId);
    url &&
      (viewImageLightboxTitleEl &&
        (viewImageLightboxTitleEl.textContent = previewTitle),
      (viewImageLightboxImg.alt = previewTitle),
      (viewImageLightboxImg.src = url));
  }

  function updatePreviewNavButtons() {
    const ids = imageIds;
    const count = ids.length;
    const previewHidden = mapPreviewEl?.hidden ?? true;
    const currentId = previewImageId;
    const index = currentId ? ids.indexOf(currentId) : -1;
    const disabled = previewHidden || !currentId || count <= 1 || index < 0;
    const prevDisabled = disabled || index <= 0;
    const nextDisabled = disabled || index >= count - 1;
    mapPreviewPrevBtn && (mapPreviewPrevBtn.disabled = prevDisabled);
    mapPreviewNextBtn && (mapPreviewNextBtn.disabled = nextDisabled);
    viewImageLightboxPrevBtn &&
      (viewImageLightboxPrevBtn.disabled = prevDisabled);
    viewImageLightboxNextBtn &&
      (viewImageLightboxNextBtn.disabled = nextDisabled);
  }

  async function selectView(imageId, selectOptions = {}) {
    const { animateMap = false, markerConeKey: fromMarker = false } =
      selectOptions;
    const record = coneRecords.get(imageId);
    if (
      record?.geometry &&
      ((activeImageId = imageId),
      setSelectedTile(imageId),
      hideHoverPopup(),
      showMapPreview(record.title || 'Untitled', imageId),
      (markerConeKey = fromMarker ? imageId : null),
      await showConeGraphic(imageId),
      syncLightbox(),
      animateMap)
    )
      try {
        await view.goTo(
          {
            target: record.geometry,
            padding: { top: 48, bottom: 48, left: 380, right: 48 },
          },
          {
            animate: true,
            animationMode: 'always',
            duration: 1350,
            easing: 'cubic-in-out',
          },
        );
      } catch {}
  }

  function stepSelection(delta) {
    const ids = imageIds;
    if (ids.length <= 1 || !previewImageId) return;
    let index = ids.indexOf(previewImageId);
    index < 0 && (index = 0);
    const nextIndex = Math.min(ids.length - 1, Math.max(0, index + delta));
    nextIndex !== index && selectView(ids[nextIndex], { animateMap: true });
  }

  function clearSelection() {
    activeImageId = null;
    markerConeKey = null;
    hoveredGraphic = null;
    setSelectedTile(null);
    hideHoverPopup();
    clearMapPreview();
    coneGraphicsLayer.removeAll();
  }

  function showMapPreview(title, imageId) {
    if (!mapPreviewEl || !mapPreviewImgEl) return;
    const resolvedTitle = title?.trim() || 'Historical view';
    previewTitle = resolvedTitle;
    previewImageId = imageId;
    mapPreviewTitleEl && (mapPreviewTitleEl.textContent = resolvedTitle);
    mapPreviewImgEl.alt = resolvedTitle;
    mapPreviewImgEl.src = mediumUrl(imageId);
    mapPreviewEl.hidden = false;
    updatePreviewNavButtons();
  }

  function openLightbox() {
    if (!previewImageId || !viewImageLightbox || !viewImageLightboxImg) return;
    const url = fullUrl(previewImageId);
    url &&
      (viewImageLightboxTitleEl &&
        (viewImageLightboxTitleEl.textContent = previewTitle),
      (viewImageLightboxImg.alt = previewTitle),
      (viewImageLightboxImg.src = url),
      viewImageLightbox.showModal());
  }

  const listenerAbortController = new AbortController();
  (mapPreviewExpandBtn?.addEventListener(
    'click',
    () => {
      openLightbox();
    },
    { signal: listenerAbortController.signal },
  ),
    viewImageLightboxCloseBtn?.addEventListener(
      'click',
      () => {
        closeLightbox();
      },
      { signal: listenerAbortController.signal },
    ),
    viewImageLightbox?.addEventListener(
      'click',
      (event) => {
        event.target === viewImageLightbox && closeLightbox();
      },
      { signal: listenerAbortController.signal },
    ),
    viewImageLightbox?.addEventListener('close', clearLightbox, {
      signal: listenerAbortController.signal,
    }),
    mapPreviewPrevBtn?.addEventListener('click', () => stepSelection(-1), {
      signal: listenerAbortController.signal,
    }),
    mapPreviewNextBtn?.addEventListener('click', () => stepSelection(1), {
      signal: listenerAbortController.signal,
    }),
    viewImageLightboxPrevBtn?.addEventListener(
      'click',
      () => stepSelection(-1),
      { signal: listenerAbortController.signal },
    ),
    viewImageLightboxNextBtn?.addEventListener(
      'click',
      () => stepSelection(1),
      {
        signal: listenerAbortController.signal,
      },
    ),
    viewImageLightbox?.addEventListener(
      'keydown',
      (event) => {
        event.key === 'ArrowLeft'
          ? (event.preventDefault(), stepSelection(-1))
          : event.key === 'ArrowRight' &&
            (event.preventDefault(), stepSelection(1));
      },
      { signal: listenerAbortController.signal },
    ));

  async function showConeGraphic(imageId) {
    const record = coneRecords.get(imageId);
    if (!record?.geometry) return;
    if (!coneGraphicsLayerView)
      try {
        coneGraphicsLayerView = await view.whenLayerView(coneGraphicsLayer);
      } catch {
        return;
      }
    coneGraphicsLayer.removeAll();
    const graphic = new Graphic({
      geometry: record.geometry,
      attributes: { imageid: imageId },
      symbol: coneSymbol,
    });
    coneGraphicsLayer.add(graphic);
  }

  function clearConeGraphicsIfIdle() {
    activeImageId === null && coneGraphicsLayer.removeAll();
  }

  function resolveHoverTarget(graphic) {
    const attributes = graphic.attributes ?? {};
    const imgField = layerFields?.imgF;
    const titleField = layerFields?.titleF;
    let imageKey = '';
    if (
      (imgField &&
      attributes[imgField] !== undefined &&
      attributes[imgField] !== null
        ? (imageKey = String(attributes[imgField]))
        : ((graphic.layer === markerGraphicsLayer &&
            attributes.imageid != null &&
            attributes.imageid !== '') ||
            (attributes.imageid != null && attributes.imageid !== '')) &&
          (imageKey = String(attributes.imageid)),
      !imageKey)
    )
      return null;
    const record = coneRecords.get(imageKey);
    const title =
      titleField &&
      attributes[titleField] !== undefined &&
      attributes[titleField] !== null
        ? String(attributes[titleField])
        : (record?.title ?? '');
    return { imgKey: imageKey, title: title.trim() || 'Untitled' };
  }

  function positionHoverPopup(x, y) {
    hoverPopup.style.left = `${Math.min(window.innerWidth - 280 - 14, x + 14)}px`;
    hoverPopup.style.top = `${Math.min(window.innerHeight - 220, y + 14)}px`;
  }

  function getScreenPoint(event) {
    const mapPoint = event.mapPoint;
    if (mapPoint && view.toScreen) {
      const screenPoint = view.toScreen(mapPoint);
      const rect = view.container?.getBoundingClientRect();
      if (screenPoint && rect)
        return { x: rect.left + screenPoint.x, y: rect.top + screenPoint.y };
    }
    const nativeEvent = event.native;
    return nativeEvent && 'clientX' in nativeEvent
      ? { x: nativeEvent.clientX, y: nativeEvent.clientY }
      : { x: 0, y: 0 };
  }

  async function refresh(year) {
    const runId = ++refreshRunId;
    imageIds.length = 0;
    hoveredGraphic = null;
    clearMapPreview();
    coneRecords.clear();
    activeImageId = null;
    markerGraphicsLayer.removeAll();
    coneGraphicsLayer.removeAll();
    const layer = viewConesLayer ?? (await waitForViewConesLayer(map));
    if (runId !== refreshRunId) return;
    if (!layer) {
      setGalleryVisible(true);
      galleryEl.replaceChildren();
      const message = document.createElement('p');
      message.className = 'hist-gallery__empty';
      message.textContent = 'View cones layer was not found in the map.';
      galleryEl.appendChild(message);
      return;
    }
    viewConesLayer = layer;
    const fields = detectFields(layer);
    layerFields = fields;
    const { latF, lonF, imgF, titleF } = fields;
    if (!imgF) {
      setGalleryVisible(true);
      galleryEl.replaceChildren();
      const message = document.createElement('p');
      message.className = 'hist-gallery__empty';
      message.textContent =
        'Could not find an image id field on View Cones (expected something like imageid).';
      galleryEl.appendChild(message);
      return;
    }
    let features = [];
    try {
      features = await queryViewCones(layer, fields, year);
    } catch {
      if (runId !== refreshRunId) return;
      setGalleryVisible(true);
      galleryEl.replaceChildren();
      const message = document.createElement('p');
      message.className = 'hist-gallery__empty';
      message.textContent = 'Could not load view cones.';
      galleryEl.appendChild(message);
      return;
    }
    if (runId !== refreshRunId) return;
    layer.visible = false;
    const seenImageKeys = new Map();
    const tiles = [];
    for (const feature of features) {
      const attributes = feature.attributes ?? {};
      const imageKey = toKey(imgF ? attributes[imgF] : undefined);
      if (!imageKey || seenImageKeys.has(imageKey)) continue;
      seenImageKeys.set(imageKey, feature);
      imageIds.push(imageKey);
      const title =
        titleF &&
        attributes[titleF] !== undefined &&
        attributes[titleF] !== null
          ? String(attributes[titleF])
          : 'Untitled';
      const geometry = feature.geometry;
      geometry &&
        coneRecords.set(imageKey, { geometry, imageid: imageKey, title });
      const latLon = readLatLon(attributes, latF, lonF);
      if (latLon) {
        const point = new Point({
          longitude: latLon.lon,
          latitude: latLon.lat,
        });
        markerGraphicsLayer.add(
          new Graphic({
            geometry: point,
            symbol: markerSymbol,
            attributes: { imageid: imageKey },
          }),
        );
      }
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'hist-gallery__tile';
      tile.dataset.imageId = imageKey;
      tile.setAttribute('aria-pressed', 'false');
      tile.setAttribute('aria-label', 'Zoom map to this historical view');
      const thumb = document.createElement('img');
      thumb.className = 'hist-gallery__thumb';
      thumb.draggable = false;
      thumb.loading = 'lazy';
      thumb.alt = '';
      thumb.src = thumbUrl(imageKey);
      tile.appendChild(thumb);
      tile.addEventListener('click', async () => {
        if (selectedImageId === imageKey) {
          clearSelection();
          return;
        }
        await selectView(imageKey, { animateMap: true });
      });
      tiles.push(tile);
    }
    if (runId === refreshRunId) {
      if (imageIds.length === 0) {
        setGalleryRows(0);
        setGalleryVisible(false);
        galleryEl.replaceChildren();
        return;
      }
      setGalleryRows(imageIds.length);
      setGalleryVisible(true);
      galleryEl.replaceChildren(...tiles);
      setSelectedTile(selectedImageId);
      try {
        const layerView = await view.whenLayerView(coneGraphicsLayer);
        if (runId !== refreshRunId) return;
        coneGraphicsLayerView = layerView;
      } catch {
        if (runId !== refreshRunId) return;
        coneGraphicsLayerView = null;
      }
    }
  }

  async function attachMapInteractions() {
    const layer = await waitForViewConesLayer(map);
    layer &&
      ((viewConesLayer = layer),
      (pointerMoveHandle = view.on('pointer-move', (moveEvent) => {
        lastPointerEvent = moveEvent;
        const screenPoint = getScreenPoint(moveEvent);
        if (
          !hoverPopup.hidden &&
          hoveredGraphic !== null &&
          Math.hypot(
            screenPoint.x - lastHoverScreenPoint.x,
            screenPoint.y - lastHoverScreenPoint.y,
          ) < 10
        )
          return;
        const hoverId = ++hoverRunId;
        hoverTimer && clearTimeout(hoverTimer);
        hoverTimer = setTimeout(async () => {
          hoverTimer = null;
          if (hoverId !== hoverRunId) return;
          const currentScreenPoint = getScreenPoint(
            lastPointerEvent ?? moveEvent,
          );
          lastHoverScreenPoint = currentScreenPoint;
          if (!coneGraphicsLayerView)
            try {
              coneGraphicsLayerView =
                await view.whenLayerView(coneGraphicsLayer);
            } catch {
              return;
            }
          if (hoverId !== hoverRunId) return;
          const hitEvent = lastPointerEvent ?? moveEvent;
          const hitResponse = await view.hitTest(hitEvent, {
            include: [coneGraphicsLayer, markerGraphicsLayer],
          });
          if (hoverId !== hoverRunId) return;
          const hit = hitResponse.results?.find(
            (result) =>
              result.graphic &&
              (result.graphic.layer === coneGraphicsLayer ||
                result.graphic.layer === markerGraphicsLayer),
          );
          if (!hit?.graphic) {
            hideHoverPopup();
            clearConeGraphicsIfIdle();
            return;
          }
          const graphic = hit.graphic;
          const target = resolveHoverTarget(graphic);
          if (!target) {
            hideHoverPopup();
            clearConeGraphicsIfIdle();
            return;
          }
          const { imgKey, title } = target;
          if (!(!hoverPopup.hidden && hoveredGraphic === graphic)) {
            if (graphic.layer === markerGraphicsLayer) {
              if (
                ((activeImageId = null),
                imgKey !== markerConeKey &&
                  ((markerConeKey = imgKey),
                  await showConeGraphic(imgKey),
                  hoverId !== hoverRunId))
              )
                return;
            } else markerConeKey = null;
            hoverPopupImg instanceof HTMLImageElement &&
              imgKey !== hoverPopupImageKey &&
              ((hoverPopupImageKey = imgKey),
              (hoverPopupImg.src = mediumUrl(imgKey)));
            hoverPopupTitle && (hoverPopupTitle.textContent = title);
            hoverPopup.hidden = false;
            hoveredGraphic = graphic;
            positionHoverPopup(currentScreenPoint.x, currentScreenPoint.y);
          }
        }, 12);
      })),
      (clickHandle = view.on('click', async (clickEvent) => {
        const hit = (
          await view.hitTest(clickEvent, {
            include: [coneGraphicsLayer, markerGraphicsLayer],
          })
        ).results?.find(
          (result) =>
            result.graphic &&
            (result.graphic.layer === coneGraphicsLayer ||
              result.graphic.layer === markerGraphicsLayer),
        );
        if (!hit?.graphic) {
          clearSelection();
          return;
        }
        const graphic = hit.graphic;
        const target = resolveHoverTarget(graphic);
        if (!target) {
          clearSelection();
          return;
        }
        const { imgKey } = target;
        await selectView(imgKey, {
          animateMap: false,
          markerConeKey: graphic.layer === markerGraphicsLayer,
        });
      })),
      view.container &&
        ((mouseLeaveHandler = () => {
          hideHoverPopup();
          clearConeGraphicsIfIdle();
        }),
        view.container.addEventListener('mouseleave', mouseLeaveHandler)));
  }

  (await refresh(getYear()), await attachMapInteractions());

  function destroy() {
    hoverTimer && clearTimeout(hoverTimer);
    pointerMoveHandle?.remove();
    pointerMoveHandle = null;
    clickHandle?.remove();
    clickHandle = null;
    view.container &&
      mouseLeaveHandler &&
      view.container.removeEventListener('mouseleave', mouseLeaveHandler);
    mouseLeaveHandler = null;
    activeImageId = null;
    refreshRunId += 1;
    hideHoverPopup();
    clearMapPreview();
    listenerAbortController.abort();
    coneGraphicsLayer.removeAll();
    hoverPopup.remove();
    viewConesLayer && (viewConesLayer.visible = true);
    map.remove(coneGraphicsLayer);
    map.remove(markerGraphicsLayer);
    typeof coneGraphicsLayer.destroy == 'function' &&
      coneGraphicsLayer.destroy();
    typeof markerGraphicsLayer.destroy == 'function' &&
      markerGraphicsLayer.destroy();
    coneRecords.clear();
    imageIds.length = 0;
  }

  return {
    refresh: (year) => refresh(typeof year == 'number' ? year : getYear()),
    destroy,
  };
}
