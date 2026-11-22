<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import 'leaflet/dist/leaflet.css';

  interface ClientLocationItem {
    id: string;
    name: string;
    address?: string;
    mapLink?: string;
    lat?: number | null;
    lng?: number | null;
    defaultGarafones?: number;
    frecuenciaDias?: number;
  }

  let { clients = [] }: { clients?: ClientLocationItem[] } = $props();

  let mapContainer: HTMLDivElement | undefined = $state();
  let mode = $state<'heat' | 'both' | 'pins'>('both');
  let weightBy = $state<'garrafones' | 'frecuencia' | 'clientes'>('garrafones');

  let L: any = null;
  let map: any = null;
  let heatLayer: any = null;
  let markersLayer: any = null;
  let mapReady = $state(false);

  function extractCoordsFromLink(link?: string): { lat: number; lng: number } | null {
    if (!link) return null;
    const d3d4 = link.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (d3d4) {
      return { lat: parseFloat(d3d4[1]), lng: parseFloat(d3d4[2]) };
    }
    const pair = link.match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
    if (pair) {
      return { lat: parseFloat(pair[1]), lng: parseFloat(pair[2]) };
    }
    return null;
  }

  let geoClients = $derived.by(() => {
    return clients
      .map(c => {
        let lat = typeof c.lat === 'number' && Number.isFinite(c.lat) ? c.lat : null;
        let lng = typeof c.lng === 'number' && Number.isFinite(c.lng) ? c.lng : null;

        if (lat === null || lng === null) {
          const parsed = extractCoordsFromLink(c.mapLink);
          if (parsed) {
            lat = parsed.lat;
            lng = parsed.lng;
          }
        }

        const garrafones = Math.max(1, Number(c.defaultGarafones) || 2);
        const freq = Math.max(1, Number(c.frecuenciaDias) || 4);
        const demandaSemanal = Number(((garrafones * 7) / freq).toFixed(2));

        return {
          ...c,
          lat,
          lng,
          garrafones,
          freq,
          demandaSemanal
        };
      })
      .filter(
        (c): c is typeof c & { lat: number; lng: number } =>
          c.lat !== null &&
          c.lng !== null &&
          Math.abs(c.lat) <= 90 &&
          Math.abs(c.lng) <= 180
      );
  });

  let withoutCoordsCount = $derived(Math.max(0, clients.length - geoClients.length));

  function getIntensity(c: (typeof geoClients)[number]): number {
    if (weightBy === 'clientes') return 0.55;
    if (weightBy === 'frecuencia') {
      return Math.min(1, Math.max(0.3, c.demandaSemanal / 5));
    }
    return Math.min(1, Math.max(0.35, c.garrafones / 4));
  }

  // Crea una paleta de 256 colores RGBA para el mapa de calor
  function buildColorPalette(): Uint8ClampedArray {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 1;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 256, 0);
    grad.addColorStop(0.0, 'rgba(6, 182, 212, 0)');
    grad.addColorStop(0.2, 'rgba(6, 182, 212, 0.65)');   // cian
    grad.addColorStop(0.45, 'rgba(34, 197, 94, 0.80)');  // verde
    grad.addColorStop(0.7, 'rgba(250, 204, 21, 0.90)');  // amarillo
    grad.addColorStop(0.88, 'rgba(249, 115, 22, 0.95)'); // naranja
    grad.addColorStop(1.0, 'rgba(239, 68, 68, 1)');      // rojo intenso
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 1);
    return ctx.getImageData(0, 0, 256, 1).data;
  }

  // Capa nativa de mapa de calor sobre Canvas en Leaflet (100% compatible con Vite/ESM)
  function createNativeHeatLayer(points: Array<[number, number, number]>) {
    const palette = buildColorPalette();

    const CustomHeatLayer = L.Layer.extend({
      onAdd(leafletMap: any) {
        this._map = leafletMap;
        this._canvas = L.DomUtil.create('canvas', 'leaflet-heatmap-layer leaflet-zoom-animated');
        this._canvas.style.pointerEvents = 'none';
        this._canvas.style.position = 'absolute';
        this._canvas.style.top = '0';
        this._canvas.style.left = '0';

        const pane = leafletMap.getPanes().overlayPane;
        pane.appendChild(this._canvas);

        leafletMap.on('moveend zoomend resize', this._redraw, this);
        this._redraw();
      },

      onRemove(leafletMap: any) {
        leafletMap.off('moveend zoomend resize', this._redraw, this);
        if (this._canvas && this._canvas.parentNode) {
          this._canvas.parentNode.removeChild(this._canvas);
        }
      },

      _redraw() {
        if (!this._map || !this._canvas) return;

        const size = this._map.getSize();
        const topLeft = this._map.containerPointToLayerPoint([0, 0]);
        L.DomUtil.setPosition(this._canvas, topLeft);

        this._canvas.width = size.x;
        this._canvas.height = size.y;

        const ctx = this._canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, size.x, size.y);

        // Radio dinámico según el nivel de zoom para que se aprecie tanto de lejos como por calle
        const zoom = this._map.getZoom();
        const radius = Math.max(22, Math.min(58, (zoom - 10) * 6.5));

        // 1. Dibujar manchas radiales en escala alfa
        for (const [lat, lng, weight] of points) {
          const pt = this._map.latLngToContainerPoint([lat, lng]);
          if (
            pt.x < -radius ||
            pt.y < -radius ||
            pt.x > size.x + radius ||
            pt.y > size.y + radius
          ) {
            continue;
          }

          const grad = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, radius);
          const alpha = Math.min(0.85, Math.max(0.25, weight * 0.72));
          grad.addColorStop(0, `rgba(0, 0, 0, ${alpha})`);
          grad.addColorStop(0.5, `rgba(0, 0, 0, ${alpha * 0.45})`);
          grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
          ctx.fill();
        }

        // 2. Colorear según la densidad acumulada de cada píxel
        const img = ctx.getImageData(0, 0, size.x, size.y);
        const data = img.data;
        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3];
          if (alpha > 0) {
            const pIdx = alpha * 4;
            data[i] = palette[pIdx];
            data[i + 1] = palette[pIdx + 1];
            data[i + 2] = palette[pIdx + 2];
            data[i + 3] = palette[pIdx + 3];
          }
        }
        ctx.putImageData(img, 0, 0);
      }
    });

    return new CustomHeatLayer();
  }

  function renderLayers() {
    if (!mapReady || !L || !map) return;

    if (heatLayer) {
      map.removeLayer(heatLayer);
      heatLayer = null;
    }
    if (markersLayer) {
      map.removeLayer(markersLayer);
      markersLayer = null;
    }

    if (geoClients.length === 0) return;

    // 1. Capa de calor
    if (mode === 'heat' || mode === 'both') {
      const points: Array<[number, number, number]> = geoClients.map(c => [
        c.lat,
        c.lng,
        getIntensity(c)
      ]);
      heatLayer = createNativeHeatLayer(points).addTo(map);
    }

    // 2. Capa de puntos interactivos
    if (mode === 'pins' || mode === 'both') {
      markersLayer = L.layerGroup();
      for (const c of geoClients) {
        const marker = L.circleMarker([c.lat, c.lng], {
          radius: mode === 'pins' ? 7 : 4.5,
          fillColor: '#22d3ee',
          color: '#0f172a',
          weight: 2,
          opacity: 1,
          fillOpacity: 0.95
        });

        const safeName = (c.name || 'Cliente').replace(/</g, '&lt;');
        const safeAddr = (c.address || 'Sin dirección').replace(/</g, '&lt;');

        marker.bindPopup(`
          <div style="font-family: system-ui, sans-serif; min-width: 170px; color: #0f172a;">
            <strong style="font-size: 13px; display: block; margin-bottom: 2px;">${safeName}</strong>
            <span style="font-size: 11px; color: #334155; display: block; margin-bottom: 4px;">${safeAddr}</span>
            <span style="font-size: 11px; font-weight: 700; color: #0284c7;">
              💧 ${c.garrafones} garrafón(es) · cada ${c.freq} días
            </span>
          </div>
        `);

        marker.addTo(markersLayer);
      }
      markersLayer.addTo(map);
    }
  }

  function fitToClients() {
    if (!map || !L || geoClients.length === 0) return;
    if (geoClients.length === 1) {
      map.setView([geoClients[0].lat, geoClients[0].lng], 16);
    } else {
      const bounds = L.latLngBounds(geoClients.map(c => [c.lat, c.lng]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
    }
  }

  onMount(async () => {
    if (!mapContainer) return;

    const leafletModule = await import('leaflet');
    L = leafletModule.default ?? leafletModule;

    const defaultCenter: [number, number] =
      geoClients.length > 0 ? [geoClients[0].lat, geoClients[0].lng] : [19.5312, -99.0431];

    map = L.map(mapContainer, {
      center: defaultCenter,
      zoom: 15,
      zoomControl: true
    });

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(map);

    mapReady = true;
    renderLayers();
    fitToClients();
  });

  $effect(() => {
    mode;
    weightBy;
    geoClients;
    if (mapReady) {
      renderLayers();
    }
  });

  onDestroy(() => {
    if (map) {
      map.remove();
      map = null;
    }
  });
</script>

<div class="space-y-3">
  <!-- Controles del mapa -->
  <div class="flex flex-col sm:flex-row flex-wrap items-center justify-between gap-2 bg-slate-900/90 border border-slate-800 p-3 rounded-xl text-xs">
    <div class="flex flex-wrap items-center justify-center gap-1.5">
      <button
        type="button"
        onclick={() => (mode = 'both')}
        class="px-3 py-1.5 rounded-lg font-bold border cursor-pointer {mode === 'both'
          ? 'bg-cyan-500 text-slate-950 border-cyan-400'
          : 'bg-slate-950 text-slate-300 border-slate-700'}"
      >
        🔥 Calor + Puntos
      </button>
      <button
        type="button"
        onclick={() => (mode = 'heat')}
        class="px-3 py-1.5 rounded-lg font-bold border cursor-pointer {mode === 'heat'
          ? 'bg-cyan-500 text-slate-950 border-cyan-400'
          : 'bg-slate-950 text-slate-300 border-slate-700'}"
      >
        🌡️ Solo Calor
      </button>
      <button
        type="button"
        onclick={() => (mode = 'pins')}
        class="px-3 py-1.5 rounded-lg font-bold border cursor-pointer {mode === 'pins'
          ? 'bg-cyan-500 text-slate-950 border-cyan-400'
          : 'bg-slate-950 text-slate-300 border-slate-700'}"
      >
        📍 Solo Puntos
      </button>
    </div>

    <div class="flex flex-wrap items-center justify-center gap-2">
      <select
        bind:value={weightBy}
        class="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100"
      >
        <option value="garrafones">Intensidad por: Garrafones habituales</option>
        <option value="frecuencia">Intensidad por: Demanda semanal</option>
        <option value="clientes">Intensidad por: Cantidad de casas</option>
      </select>

      {#if geoClients.length > 0}
        <button
          type="button"
          onclick={fitToClients}
          class="bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 px-3 py-1.5 rounded-lg font-semibold cursor-pointer"
        >
          🎯 Centrar zona
        </button>
      {/if}
    </div>
  </div>

  <!-- Estadística de cobertura -->
  <div class="flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-slate-400">
    <span>
      Clientes geolocalizados en mapa: <strong class="text-cyan-300">{geoClients.length}</strong> de {clients.length}
    </span>
    {#if withoutCoordsCount > 0}
      <span class="text-amber-300/90">
        ⚠️ {withoutCoordsCount} cliente(s) sin coordenadas
      </span>
    {/if}
  </div>

  <!-- Contenedor del Mapa -->
  {#if geoClients.length === 0}
    <div class="bg-slate-950/70 border border-slate-800 rounded-xl p-8 text-center space-y-2">
      <p class="text-sm text-slate-300 font-semibold">Aún no hay clientes con coordenadas guardadas</p>
      <p class="text-xs text-slate-400">
        Al registrar o editar clientes con sus coordenadas (<code class="text-cyan-300">lat, lng</code>), aparecerán aquí automáticamente.
      </p>
    </div>
  {:else}
    <div class="puripiwi-dark-map relative rounded-xl overflow-hidden border border-slate-700 shadow-inner">
      <div bind:this={mapContainer} class="w-full h-[380px] sm:h-[440px] z-0"></div>
    </div>

    <!-- Leyenda visual -->
    <div class="flex flex-wrap items-center justify-between gap-2 bg-slate-900/70 border border-slate-800 px-3 py-2 rounded-lg text-[11px] text-slate-400">
      <span>Toca cualquier punto cian para ver nombre, dirección y consumo.</span>
      <div class="flex items-center gap-2">
        <span>Menor demanda</span>
        <span class="inline-block w-24 h-2.5 rounded-full bg-gradient-to-r from-cyan-500 via-emerald-500 via-yellow-400 to-red-500"></span>
        <span>Mayor concentración</span>
      </div>
    </div>
  {/if}
</div>

<style>
  .puripiwi-dark-map :global(.leaflet-tile-pane) {
    filter: invert(100%) hue-rotate(180deg) brightness(92%) contrast(92%) saturate(85%);
  }

  .puripiwi-dark-map :global(.leaflet-container) {
    background: #0f172a;
  }
</style>