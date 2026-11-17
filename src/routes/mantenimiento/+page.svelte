<script lang="ts">
  import { onMount } from 'svelte';
  import { db } from '$lib/firebase';
  import { collection, getDocs, doc, setDoc, getDoc } from 'firebase/firestore';

  interface Maintenance {
    lastTinacos: string;
    lastFiltros: string;
    lastMembrana: string;
  }

  interface Sale {
    garafones: number;
    date: string; // 'YYYY-MM-DD'
  }

  let maint = $state<Maintenance>({
    lastTinacos: '',
    lastFiltros: '',
    lastMembrana: ''
  });

  let sales = $state<Sale[]>([]);
  let loading = $state(true);
  let saving = $state(false);

  onMount(async () => {
    await loadData();
  });

  async function loadData() {
    try {
      loading = true;
      // 1. Cargar datos de mantenimiento desde un documento global 'config/maintenance'
      const maintDoc = await getDoc(doc(db, 'config', 'maintenance'));
      if (maintDoc.exists()) {
        maint = maintDoc.data() as Maintenance;
      }

      // 2. Cargar ventas registradas
      const salesSnap = await getDocs(collection(db, 'sales'));
      sales = salesSnap.docs.map(d => d.data()) as Sale[];
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

  // Cálculos de Contabilidad de Garrafones (Año, Mes, Semana)
  let stats = $derived(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth(); // 0-11
    
    // Obtener número de semana actual aproximado o filtrar por fechas
    let yearTotal = 0;
    let monthTotal = 0;
    let weekTotal = 0;

    // Inicio de semana (considerando lunes)
    const firstDayOfWeek = new Date(now);
    const day = now.getDay() || 7;
    if (day !== 1) firstDayOfWeek.setHours(-24 * (day - 1));
    firstDayOfWeek.setHours(0,0,0,0);

    sales.forEach(sale => {
      if (!sale.date) return;
      const saleDate = new Date(sale.date + 'T00:00:00');
      const qty = Number(sale.garafones) || 0;

      // Por Año
      if (saleDate.getFullYear() === currentYear) {
        yearTotal += qty;

        // Por Mes
        if (saleDate.getMonth() === currentMonth) {
          monthTotal += qty;
        }

        // Por Semana
        if (saleDate >= firstDayOfWeek) {
          weekTotal += qty;
        }
      }
    });

    return { yearTotal, monthTotal, weekTotal };
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
          <div class="text-3xl font-black text-cyan-400">{stats().weekTotal}</div>
          <span class="text-[11px] text-slate-500">Garrafones entregados</span>
        </div>

        <div class="bg-slate-800/80 border border-slate-700 p-4 rounded-xl text-center space-y-1 shadow-md">
          <span class="text-xs text-slate-400 uppercase font-semibold">Mes Actual</span>
          <div class="text-3xl font-black text-cyan-300">{stats().monthTotal}</div>
          <span class="text-[11px] text-slate-500">Garrafones entregados</span>
        </div>

        <div class="bg-slate-800/80 border border-slate-700 p-4 rounded-xl text-center space-y-1 shadow-md">
          <span class="text-xs text-slate-400 uppercase font-semibold">Año Actual</span>
          <div class="text-3xl font-black text-emerald-400">{stats().yearTotal}</div>
          <span class="text-[11px] text-slate-500">Garrafones entregados</span>
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