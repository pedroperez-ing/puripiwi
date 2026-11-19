<script lang="ts">
  import { onMount } from 'svelte';
  import { db } from '$lib/firebase';
  import { doc, setDoc, getDoc } from 'firebase/firestore';

  interface Maintenance {
    lastTinacos: string;
    lastFiltros: string;
    lastMembrana: string;
  }

  interface SalesCounters {
    semanaActual: number;
    semanaAnterior: number;
    weekKey?: string;
    mesActual: number;
    mesAnterior: number;
    monthKey?: string;
    anioActual: number;
    anioAnterior: number;
    yearKey?: string;
  }

  let maint = $state<Maintenance>({
    lastTinacos: '',
    lastFiltros: '',
    lastMembrana: ''
  });

  let rawSales = $state<SalesCounters>({
    semanaActual: 0,
    semanaAnterior: 0,
    mesActual: 0,
    mesAnterior: 0,
    anioActual: 0,
    anioAnterior: 0
  });

  let loading = $state(true);
  let saving = $state(false);

  onMount(async () => {
    await loadData();
  });

  function getWeekMondayKey(date: Date): string {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  function getPrevWeekMondayKey(date: Date): string {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 7);
    return getWeekMondayKey(d);
  }

  function getMonthKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  function getPrevMonthKey(date: Date): string {
    const d = new Date(date.getFullYear(), date.getMonth() - 1, 1);
    return getMonthKey(d);
  }

  function getYearKey(date: Date): string {
    return `${date.getFullYear()}`;
  }

  function getPrevYearKey(date: Date): string {
    return `${date.getFullYear() - 1}`;
  }

  async function loadData() {
    try {
      loading = true;
      // 1. Cargar datos de mantenimiento desde un documento global 'config/maintenance'
      const maintDoc = await getDoc(doc(db, 'config', 'maintenance'));
      if (maintDoc.exists()) {
        maint = maintDoc.data() as Maintenance;
      }

      // 2. Cargar contador único de ventas desde 'stats/ventas'
      const salesDoc = await getDoc(doc(db, 'stats', 'ventas'));
      if (salesDoc.exists()) {
        rawSales = { ...rawSales, ...(salesDoc.data() as SalesCounters) };
      }
    } catch (error) {
      console.error('Error al cargar datos de mantenimiento y ventas:', error);
    } finally {
      loading = false;
    }
  }

  async function saveMaintenance(e: Event) {
    e.preventDefault();
    try {
      saving = true;
      await setDoc(doc(db, 'config', 'maintenance'), maint);
      alert('¡Fechas de mantenimiento actualizadas con éxito!');
    } catch (error) {
      console.error('Error al guardar mantenimiento:', error);
      alert('Error al guardar los datos.');
    } finally {
      saving = false;
    }
  }

  // Ajuste automático en pantalla si ya cambió la semana, el mes o el año calendario
  let stats = $derived.by(() => {
    const now = new Date();
    const curWeek = getWeekMondayKey(now);
    const prevWeek = getPrevWeekMondayKey(now);
    const curMonth = getMonthKey(now);
    const prevMonth = getPrevMonthKey(now);
    const curYear = getYearKey(now);
    const prevYear = getPrevYearKey(now);

    let weekTotal = 0;
    let weekPrev = 0;
    if (rawSales.weekKey === curWeek) {
      weekTotal = Number(rawSales.semanaActual) || 0;
      weekPrev = Number(rawSales.semanaAnterior) || 0;
    } else if (rawSales.weekKey === prevWeek) {
      weekTotal = 0;
      weekPrev = Number(rawSales.semanaActual) || 0;
    }

    let monthTotal = 0;
    let monthPrev = 0;
    if (rawSales.monthKey === curMonth) {
      monthTotal = Number(rawSales.mesActual) || 0;
      monthPrev = Number(rawSales.mesAnterior) || 0;
    } else if (rawSales.monthKey === prevMonth) {
      monthTotal = 0;
      monthPrev = Number(rawSales.mesActual) || 0;
    }

    let yearTotal = 0;
    let yearPrev = 0;
    if (rawSales.yearKey === curYear) {
      yearTotal = Number(rawSales.anioActual) || 0;
      yearPrev = Number(rawSales.anioAnterior) || 0;
    } else if (rawSales.yearKey === prevYear) {
      yearTotal = 0;
      yearPrev = Number(rawSales.anioActual) || 0;
    }

    return { weekTotal, weekPrev, monthTotal, monthPrev, yearTotal, yearPrev };
  });
</script>

<div class="space-y-6">
  <!-- Cabecera -->
  <div class="bg-slate-800/60 p-4 rounded-xl border border-slate-700">
    <h2 class="text-xl font-bold text-cyan-300">⚙️ Mantenimiento de Equipos & Contabilidad</h2>
    <p class="text-xs text-slate-400">Supervisa el estado de tus sistemas de purificación y el balance de ventas de garrafones.</p>
  </div>

  {#if loading}
    <div class="text-center py-12 text-slate-400 animate-pulse">Cargando registros...</div>
  {:else}
    <!-- SECCIÓN 1: CONTABILIDAD DE VENTAS -->
    <div class="space-y-3">
      <h3 class="font-bold text-slate-200 text-sm">📊 Balance de Garrafones Vendidos</h3>
      
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div class="bg-slate-800/80 border border-slate-700 p-4 rounded-xl text-center space-y-1 shadow-md">
          <span class="text-xs text-slate-400 uppercase font-semibold">Semana Actual</span>
          <div class="text-3xl font-black text-cyan-400">{stats.weekTotal}</div>
          <span class="text-[11px] text-slate-500 block">Garrafones entregados</span>
          <div class="pt-1 border-t border-slate-700/70 text-[11px] text-slate-400">
            Semana anterior: <strong class="text-slate-200">{stats.weekPrev}</strong>
          </div>
        </div>

        <div class="bg-slate-800/80 border border-slate-700 p-4 rounded-xl text-center space-y-1 shadow-md">
          <span class="text-xs text-slate-400 uppercase font-semibold">Mes Actual</span>
          <div class="text-3xl font-black text-cyan-300">{stats.monthTotal}</div>
          <span class="text-[11px] text-slate-500 block">Garrafones entregados</span>
          <div class="pt-1 border-t border-slate-700/70 text-[11px] text-slate-400">
            Mes anterior: <strong class="text-slate-200">{stats.monthPrev}</strong>
          </div>
        </div>

        <div class="bg-slate-800/80 border border-slate-700 p-4 rounded-xl text-center space-y-1 shadow-md">
          <span class="text-xs text-slate-400 uppercase font-semibold">Año Actual</span>
          <div class="text-3xl font-black text-emerald-400">{stats.yearTotal}</div>
          <span class="text-[11px] text-slate-500 block">Garrafones entregados</span>
          <div class="pt-1 border-t border-slate-700/70 text-[11px] text-slate-400">
            Año anterior: <strong class="text-slate-200">{stats.yearPrev}</strong>
          </div>
        </div>
      </div>
    </div>

    <!-- SECCIÓN 2: MANTENIMIENTO DE EQUIPOS -->
    <div class="bg-slate-800/60 border border-slate-700 rounded-xl p-5 space-y-4">
      <div>
        <h3 class="font-bold text-cyan-300 text-base">🛠️ Mantenimiento de Sistemas de Purificación</h3>
        <p class="text-xs text-slate-400">Actualiza las fechas de servicio. El registro aplica de forma general para tus equipos.</p>
      </div>

      <form onsubmit={saveMaintenance} class="space-y-4 text-sm">
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div class="bg-slate-900/80 p-3 rounded-lg border border-slate-700 space-y-2">
            <label class="block text-xs font-bold text-slate-300">🚿 Último Lavado de Tinacos</label>
            <input type="date" bind:value={maint.lastTinacos} class="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-100 text-xs focus:border-cyan-400 focus:outline-none" />
          </div>

          <div class="bg-slate-900/80 p-3 rounded-lg border border-slate-700 space-y-2">
            <label class="block text-xs font-bold text-slate-300">🔄 Último Cambio de Filtros</label>
            <input type="date" bind:value={maint.lastFiltros} class="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-100 text-xs focus:border-cyan-400 focus:outline-none" />
          </div>

          <div class="bg-slate-900/80 p-3 rounded-lg border border-slate-700 space-y-2">
            <label class="block text-xs font-bold text-slate-300">💧 Membrana Ósmosis Inversa</label>
            <input type="date" bind:value={maint.lastMembrana} class="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-100 text-xs focus:border-cyan-400 focus:outline-none" />
          </div>
        </div>

        <div class="flex justify-end pt-2">
          <button 
            type="submit" 
            disabled={saving}
            class="bg-cyan-500 hover:bg-cyan-600 text-slate-950 font-bold px-6 py-2.5 rounded-xl transition-colors shadow-lg text-sm cursor-pointer disabled:opacity-50"
          >
            {saving ? 'Guardando...' : '💾 Guardar Fechas de Mantenimiento'}
          </button>
        </div>
      </form>
    </div>
  {/if}
</div>