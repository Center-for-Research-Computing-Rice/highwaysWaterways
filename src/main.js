import WebMap from '@arcgis/core/WebMap.js';
import MapView from '@arcgis/core/views/MapView.js';
import FeatureFilter from '@arcgis/core/layers/support/FeatureFilter.js';
import './style.css';
import { buildYearWhere, layerHasYearFields } from './yearFilter.js';
import { LEGEND_PRESENCE_EVENT, createLegendPanel } from './legendPanel.js';
import { createViewConesGallery } from './viewConesGallery.js';
import { createMapExtentsGallery } from './mapExtentsGallery.js';

globalThis.esriConfig = { respectPrefersReducedMotion: false };

const PORTAL_ITEM_ID = '42c5524f70434751bd0a42ed42c9cfe4';
const YEAR_MIN = 1836;
const YEAR_MAX = 2040;
const YEAR_STEP = 1;
const TICK_MIN = 1840;
const TICK_MAX = 2040;
const TICK_STEP = 10;
const INITIAL_YEAR = 1912;
const YEAR_SPAN = YEAR_MAX - YEAR_MIN;
const LEGEND_PRESENCE_DEBOUNCE_MS = 480;

let presenceTimer = null;
let refreshViewCones = null;
let refreshMapExtents = null;

function schedulePresenceEvent(year) {
  clearTimeout(presenceTimer);
  presenceTimer = setTimeout(() => {
    presenceTimer = null;
    window.dispatchEvent(
      new CustomEvent(LEGEND_PRESENCE_EVENT, { detail: { year } }),
    );
  }, LEGEND_PRESENCE_DEBOUNCE_MS);
}

const FILTERABLE_LAYER_TYPES = new Set([
  'feature',
  'geo-json',
  'csv',
  'ogc-feature',
]);

function isFilterableLayer(layer) {
  return (
    layer && layer.type !== 'group' && FILTERABLE_LAYER_TYPES.has(layer.type)
  );
}

function applyLayerViewFilter(layer, layerView, where) {
  if (!isFilterableLayer(layer) || !('filter' in layerView)) return;
  const apply = () => {
    if (!layerHasYearFields(layer)) {
      layerView.filter = null;
      return;
    }
    layerView.filter = where ? new FeatureFilter({ where }) : null;
  };
  layer.loaded
    ? apply()
    : layer
        .load()
        .then(apply)
        .catch(() => {});
}

function applyYearFilter(view, map, year) {
  const where = buildYearWhere(year);
  map.allLayers.forEach((layer) => {
    isFilterableLayer(layer) &&
      layer
        .load()
        .then(() => {
          if (layerHasYearFields(layer))
            return view.whenLayerView(layer).then((layerView) => {
              layerView.filter = where ? new FeatureFilter({ where }) : null;
            });
        })
        .catch(() => {});
  });
}

const map = new WebMap({ portalItem: { id: PORTAL_ITEM_ID } });
const view = new MapView({
  container: 'viewDiv',
  map,
  animationsEnabled: true,
});

const yearSlider = document.getElementById('yearSlider');
const yearValue = document.getElementById('yearValue');
const yearPrev = document.getElementById('yearPrev');
const yearNext = document.getElementById('yearNext');
const yearTickLabels = document.getElementById('yearTickLabels');
const yearTrackFill = document.getElementById('yearTrackFill');

yearSlider.min = String(YEAR_MIN);
yearSlider.max = String(YEAR_MAX);
yearSlider.step = String(YEAR_STEP);
yearSlider.setAttribute('aria-valuemin', String(YEAR_MIN));
yearSlider.setAttribute('aria-valuemax', String(YEAR_MAX));

function renderTickLabels() {
  yearTickLabels.replaceChildren();
  for (let tick = TICK_MIN; tick <= TICK_MAX; tick += TICK_STEP) {
    const label = document.createElement('span');
    label.className = 'time-rail__label';
    label.textContent = String(tick);
    yearTickLabels.appendChild(label);
  }
}

function updateTrackFill(year) {
  const fraction = (year - YEAR_MIN) / YEAR_SPAN;
  yearTrackFill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
}

function setYear(value, { skipSlider } = {}) {
  const year = Math.min(
    YEAR_MAX,
    Math.max(YEAR_MIN, Number.parseInt(String(value), 10)),
  );
  skipSlider || (yearSlider.value = String(year));
  yearSlider.setAttribute('aria-valuenow', String(year));
  yearValue.textContent = String(year);
  updateTrackFill(year);
  applyYearFilter(view, map, year);
  schedulePresenceEvent(year);
  refreshViewCones && refreshViewCones(year);
  refreshMapExtents && refreshMapExtents(year);
}

function getSliderYear() {
  return Number.parseInt(yearSlider.value, 10);
}

function onSliderInput() {
  setYear(getSliderYear(), { skipSlider: true });
}

yearSlider.addEventListener('input', onSliderInput);
yearPrev.addEventListener('click', () => {
  setYear(getSliderYear() - YEAR_STEP);
});
yearNext.addEventListener('click', () => {
  setYear(getSliderYear() + YEAR_STEP);
});
renderTickLabels();
setYear(INITIAL_YEAR);

view
  .when(async () => {
    applyYearFilter(view, map, getSliderYear());
    await map.when();
    await view.when();
    const homeViewpoint = view.viewpoint.clone();
    const homeButton = document.createElement('button');
    homeButton.type = 'button';
    homeButton.className = 'ih-map-home esri-widget esri-component';
    homeButton.title = 'Home';
    homeButton.setAttribute('aria-label', 'Home');
    homeButton.innerHTML =
      '<span class="ih-map-home__icon" aria-hidden="true">⌂</span>';
    homeButton.addEventListener('click', () => {
      view.goTo(homeViewpoint, {
        animate: true,
        animationMode: 'always',
        duration: 1200,
        easing: 'cubic-in-out',
      });
    });
    view.ui.add(homeButton, 'top-left');
    view.on('layerview-create', (event) => {
      const where = buildYearWhere(getSliderYear());
      applyLayerViewFilter(event.layer, event.layerView, where);
    });

    const galleryContent = document.getElementById('galleryContent');
    galleryContent &&
      (refreshViewCones = (
        await createViewConesGallery(view, map, {
          galleryEl: galleryContent,
          getYear: getSliderYear,
          mapPreviewEl: document.getElementById('mapViewPreview'),
          mapPreviewTitleEl: document.getElementById('mapViewPreviewTitle'),
          mapPreviewImgEl: document.getElementById('mapViewPreviewImg'),
          mapPreviewExpandBtn: document.getElementById('mapViewPreviewExpand'),
          mapPreviewPrevBtn: document.getElementById('mapViewPreviewPrev'),
          mapPreviewNextBtn: document.getElementById('mapViewPreviewNext'),
          viewImageLightbox: document.getElementById('viewImageLightbox'),
          viewImageLightboxTitleEl: document.getElementById(
            'viewImageLightboxTitle',
          ),
          viewImageLightboxImg: document.getElementById('viewImageLightboxImg'),
          viewImageLightboxCloseBtn: document.getElementById(
            'viewImageLightboxClose',
          ),
          viewImageLightboxPrevBtn: document.getElementById(
            'viewImageLightboxPrev',
          ),
          viewImageLightboxNextBtn: document.getElementById(
            'viewImageLightboxNext',
          ),
        })
      ).refresh);

    const mapGalleryContent = document.getElementById('mapGalleryContent');
    mapGalleryContent &&
      (refreshMapExtents = (
        await createMapExtentsGallery(view, map, {
          galleryEl: mapGalleryContent,
          getYear: getSliderYear,
          mapPreviewEl: document.getElementById('mapTilePreview'),
          mapPreviewTitleEl: document.getElementById('mapTilePreviewTitle'),
          mapPreviewImgEl: document.getElementById('mapTilePreviewImg'),
          mapPreviewCloseBtn: document.getElementById('mapTilePreviewClose'),
          mapOpacityRangeEl: document.getElementById('mapTileOpacity'),
          mapOpacityValueEl: document.getElementById('mapTileOpacityValue'),
        })
      ).refresh);

    const legendContent = document.getElementById('legendContent');
    legendContent && createLegendPanel(view, legendContent, { getSliderYear });
  })
  .catch((error) => {
    console.error(error);
    yearValue.textContent = 'Map error';
  });
