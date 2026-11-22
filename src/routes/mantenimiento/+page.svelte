<script lang="ts">
  import { onMount } from 'svelte';
  import { db } from '$lib/firebase';
  import { collection, doc, setDoc, getDoc, getDocs } from 'firebase/firestore';
  import HeatmapClientes from '$lib/components/HeatmapClientes.svelte';
  import type {
    AccountingReportDoc,
    CostConfig,
    MaintenanceState,
    SalesCounters
  } from '$lib/types/purificadora';
  import {
    DEFAULT_COST_CONFIG,
    DEFAULT_MAINTENANCE_STATE,
    calcularCostosUnitarios,
    construirInformeMensual
  } from '$lib/utils/contabilidad';

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

  let maint = $state<MaintenanceState>({ ...DEFAULT_MAINTENANCE_STATE });
  let prevMaintDates = $state({
    lastFiltros: '',
    lastMembrana: ''
  });

  let costConfig = $state<CostConfig>({ ...DEFAULT_COST_CONFIG });
  let showCostEditor = $state(false);
  let savingCosts = $state(false);

  // Estado bajo demanda para el Mapa de Calor
  let showHeatmap = $state(false);
  let loadingHeatmapClients = $state(false);
  let heatmapClients = $state<ClientLocationItem[]>([]);
  let heatmapLoadedOnce = $state(false);

  let rawSales = $state<SalesCounters>({
    semanaActual: 0,
    semanaAnterior: 0,
    mesActual: 0,
    mesAnterior: 0,
    anioActual: 0,
    anioAnterior: 0,
    kmSemanaActual: 0,
    kmSemanaAnterior: 0,
    kmMesActual: 0,
    kmMesAnterior: 0,
    kmAnioActual: 0,
    kmAnioAnterior: 0
  });

  let reportDoc = $state<AccountingReportDoc>({
    months: {},
    osmosisDatesAllTime: [],
    totalFiltrosAllTime: 0
  });

  let loading = $state(true);
  let saving = $state(false);

  const nowInitial = new Date();
  let selectedMonthKey = $state(
    `${nowInitial.getFullYear()}-${String(nowInitial.getMonth() + 1).padStart(2, '0')}`
  );
  let selectedYearKey = $state(`${nowInitial.getFullYear()}`);
  let reportMode = $state<'mensual' | 'anual'>('mensual');

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

  function formatMoney(val: number): string {
    return `$${(Number(val) || 0).toFixed(2)}`;
  }

  async function loadData() {
    try {
      loading = true;

      const [maintSnap, salesSnap, costsSnap, reportSnap] = await Promise.all([
        getDoc(doc(db, 'config', 'maintenance')),
        getDoc(doc(db, 'stats', 'ventas')),
        getDoc(doc(db, 'config', 'costs')),
        getDoc(doc(db, 'stats', 'reportes'))
      ]);

      if (maintSnap.exists()) {
        const d = maintSnap.data() as Partial<MaintenanceState>;
        maint = {
          ...DEFAULT_MAINTENANCE_STATE,
          ...d,
          lastTinacos: d.lastTinacos || '',
          lastFiltros: d.lastFiltros || '',
          lastMembrana: d.lastMembrana || '',
          garrafonesDesdeFiltros: Number(d.garrafonesDesdeFiltros) || 0,
          garrafonesDesdeMembrana: Number(d.garrafonesDesdeMembrana) || 0,
          juegosFiltrosUsadosTotal: Number(d.juegosFiltrosUsadosTotal) || 0,
          cambiosOsmosisHistorial: Array.isArray(d.cambiosOsmosisHistorial)
            ? d.cambiosOsmosisHistorial
            : []
        };
        prevMaintDates = {
          lastFiltros: maint.lastFiltros,
          lastMembrana: maint.lastMembrana
        };
      }

      if (salesSnap.exists()) {
        rawSales = { ...rawSales, ...(salesSnap.data() as SalesCounters) };
      }

      if (costsSnap.exists()) {
        costConfig = { ...DEFAULT_COST_CONFIG, ...(costsSnap.data() as Partial<CostConfig>) };
      }

      if (reportSnap.exists()) {
        const r = reportSnap.data() as Partial<AccountingReportDoc>;
        reportDoc = {
          months: r.months || {},
          osmosisDatesAllTime: Array.isArray(r.osmosisDatesAllTime) ? r.osmosisDatesAllTime : [],
          totalFiltrosAllTime: Number(r.totalFiltrosAllTime) || 0
        };
      }
    } catch (error) {
      console.error('Error al cargar datos de mantenimiento y contabilidad:', error);
    } finally {
      loading = false;
    }
  }

  async function toggleHeatmap(forceReload = false) {
    if (showHeatmap && !forceReload) {
      showHeatmap = false;
      return;
    }

    showHeatmap = true;
    if (heatmapLoadedOnce && !forceReload) return;

    try {
      loadingHeatmapClients = true;
      const snap = await getDocs(collection(db, 'clients'));
      heatmapClients = snap.docs.map(d => ({
        id: d.id,
        ...d.data()
      })) as ClientLocationItem[];
      heatmapLoadedOnce = true;
    } catch (error) {
      console.error('Error al cargar ubicaciones de clientes para mapa de calor:', error);
      alert('No se pudieron cargar las ubicaciones de los clientes.');
    } finally {
      loadingHeatmapClients = false;
    }
  }

  async function saveCostConfig(e: Event) {
    e.preventDefault();
    if (savingCosts) return;
    savingCosts = true;
    try {
      const normalized: CostConfig = {
        precioGarrafon: Number(costConfig.precioGarrafon) || 21,
        costoTapa: Number(costConfig.costoTapa) || 0,
        costoSello: Number(costConfig.costoSello) || 0,
        costoJabonCloro: Number(costConfig.costoJabonCloro) || 0,
        rendimientoKmPorLitro: Number(costConfig.rendimientoKmPorLitro) || 15,
        precioGasolinaLitro: Number(costConfig.precioGasolinaLitro) || 25,
        costoJuegoFiltros: Number(costConfig.costoJuegoFiltros) || 110,
        filtrosPorJuego: Math.max(1, Number(costConfig.filtrosPorJuego) || 3),
        costoMembranaUnitaria: Number(costConfig.costoMembranaUnitaria) || 1000,
        cantidadMembranas: Math.max(1, Number(costConfig.cantidadMembranas) || 2),
        costoLavadoTinacos: Number(costConfig.costoLavadoTinacos) || 0,
        costoLuzMensual: Number(costConfig.costoLuzMensual) || 0,
        costoAguaMensual: Number(costConfig.costoAguaMensual) || 0
      };
      await setDoc(doc(db, 'config', 'costs'), normalized, { merge: true });
      costConfig = normalized;
      showCostEditor = false;
      alert('¡Parámetros de costos guardados!');
    } catch (error: any) {
      console.error('Error al guardar costos:', error);
      alert(`No se pudieron guardar los costos (${error?.code || error?.message || 'error de red'}).`);
    } finally {
      savingCosts = false;
    }
  }

  async function saveMaintenance(e: Event) {
    e.preventDefault();
    if (saving) return;

    saving = true;
    try {
      const now = new Date();
      const curMonth = getMonthKey(now);

      const filtroChanged =
        Boolean(maint.lastFiltros) && maint.lastFiltros !== prevMaintDates.lastFiltros;
      const osmosisChanged =
        Boolean(maint.lastMembrana) && maint.lastMembrana !== prevMaintDates.lastMembrana;

      let nextGarrafonesFiltros = Number(maint.garrafonesDesdeFiltros) || 0;
      let nextGarrafonesOsmosis = Number(maint.garrafonesDesdeMembrana) || 0;
      let nextJuegosFiltrosTotal = Number(maint.juegosFiltrosUsadosTotal) || 0;
      let nextOsmosisHistorial = [...(maint.cambiosOsmosisHistorial || [])];

      const monthsMap = { ...(reportDoc.months || {}) };
      const monthEntry = construirInformeMensual(curMonth, monthsMap[curMonth], costConfig);
      let nextOsmosisAllTime = [...(reportDoc.osmosisDatesAllTime || [])];
      let nextFiltrosAllTime =
        Number(reportDoc.totalFiltrosAllTime) || nextJuegosFiltrosTotal;

      if (filtroChanged) {
        nextJuegosFiltrosTotal += 1;
        nextFiltrosAllTime += 1;
        monthEntry.juegosFiltrosUsados = (Number(monthEntry.juegosFiltrosUsados) || 0) + 1;
        nextGarrafonesFiltros = 0;
      }

      if (osmosisChanged) {
        const record = {
          date: maint.lastMembrana,
          garrafonesCicloAnterior: nextGarrafonesOsmosis
        };
        nextOsmosisHistorial = [record, ...nextOsmosisHistorial];
        nextOsmosisAllTime = [record, ...nextOsmosisAllTime];
        const fechasMes = new Set(monthEntry.cambiosOsmosisFechas || []);
        fechasMes.add(maint.lastMembrana);
        monthEntry.cambiosOsmosisFechas = Array.from(fechasMes);
        nextGarrafonesOsmosis = 0;
      }

      const updatedMaint: MaintenanceState = {
        ...maint,
        garrafonesDesdeFiltros: nextGarrafonesFiltros,
        garrafonesDesdeMembrana: nextGarrafonesOsmosis,
        juegosFiltrosUsadosTotal: nextJuegosFiltrosTotal,
        cambiosOsmosisHistorial: nextOsmosisHistorial
      };

      monthsMap[curMonth] = construirInformeMensual(curMonth, monthEntry, costConfig);

      await Promise.all([
        setDoc(doc(db, 'config', 'maintenance'), updatedMaint, { merge: true }),
        setDoc(
          doc(db, 'stats', 'reportes'),
          {
            months: monthsMap,
            osmosisDatesAllTime: nextOsmosisAllTime,
            totalFiltrosAllTime: nextFiltrosAllTime
          },
          { merge: true }
        )
      ]);

      maint = updatedMaint;
      reportDoc = {
        months: monthsMap,
        osmosisDatesAllTime: nextOsmosisAllTime,
        totalFiltrosAllTime: nextFiltrosAllTime
      };
      prevMaintDates = {
        lastFiltros: maint.lastFiltros,
        lastMembrana: maint.lastMembrana
      };

      alert('¡Mantenimiento y registros actualizados con éxito!');
    } catch (error: any) {
      console.error('Error al guardar mantenimiento:', error);
      alert(
        `No se pudieron guardar los datos (${error?.code || error?.message || 'error de red'}). Revisa tu conexión e intenta de nuevo.`
      );
    } finally {
      saving = false;
    }
  }

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
    let kmWeek = 0;
    let kmWeekPrev = 0;
    if (rawSales.weekKey === curWeek) {
      weekTotal = Number(rawSales.semanaActual) || 0;
      weekPrev = Number(rawSales.semanaAnterior) || 0;
      kmWeek = Number(rawSales.kmSemanaActual) || 0;
      kmWeekPrev = Number(rawSales.kmSemanaAnterior) || 0;
    } else if (rawSales.weekKey === prevWeek) {
      weekTotal = 0;
      weekPrev = Number(rawSales.semanaActual) || 0;
      kmWeek = 0;
      kmWeekPrev = Number(rawSales.kmSemanaActual) || 0;
    }

    let monthTotal = 0;
    let monthPrev = 0;
    let kmMonth = 0;
    let kmMonthPrev = 0;
    if (rawSales.monthKey === curMonth) {
      monthTotal = Number(rawSales.mesActual) || 0;
      monthPrev = Number(rawSales.mesAnterior) || 0;
      kmMonth = Number(rawSales.kmMesActual) || 0;
      kmMonthPrev = Number(rawSales.kmMesAnterior) || 0;
    } else if (rawSales.monthKey === prevMonth) {
      monthTotal = 0;
      monthPrev = Number(rawSales.mesActual) || 0;
      kmMonth = 0;
      kmMonthPrev = Number(rawSales.kmMesActual) || 0;
    }

    let yearTotal = 0;
    let yearPrev = 0;
    let kmYear = 0;
    let kmYearPrev = 0;
    if (rawSales.yearKey === curYear) {
      yearTotal = Number(rawSales.anioActual) || 0;
      yearPrev = Number(rawSales.anioAnterior) || 0;
      kmYear = Number(rawSales.kmAnioActual) || 0;
      kmYearPrev = Number(rawSales.kmAnioAnterior) || 0;
    } else if (rawSales.yearKey === prevYear) {
      yearTotal = 0;
      yearPrev = Number(rawSales.anioActual) || 0;
      kmYear = 0;
      kmYearPrev = Number(rawSales.kmAnioActual) || 0;
    }

    return {
      weekTotal,
      weekPrev,
      monthTotal,
      monthPrev,
      yearTotal,
      yearPrev,
      kmWeek,
      kmWeekPrev,
      kmMonth,
      kmMonthPrev,
      kmYear,
      kmYearPrev
    };
  });

  // Resumen financiero claro: Ventas - Gastos = Ganancia (Semana, Mes, Año + periodo anterior)
  let moneySummary = $derived.by(() => {
    const now = new Date();
    const curMonthKey = getMonthKey(now);
    const prevMonthKey = getPrevMonthKey(now);
    const curYearKey = getYearKey(now);
    const prevYearKey = getPrevYearKey(now);

    const price = Number(costConfig.precioGarrafon) || 21;
    const directPerUnit =
      (Number(costConfig.costoTapa) || 0) +
      (Number(costConfig.costoSello) || 0) +
      (Number(costConfig.costoJabonCloro) || 0);
    const kmPerLiter = Math.max(1, Number(costConfig.rendimientoKmPorLitro) || 15);
    const gasPrice = Number(costConfig.precioGasolinaLitro) || 0;
    const gasPerKm = gasPrice / kmPerLiter;

    // Semana actual y semana anterior (ventas directas + gasolina de ruta)
    const weekSales = stats.weekTotal * price;
    const weekExpenses = stats.weekTotal * directPerUnit + stats.kmWeek * gasPerKm;
    const weekProfit = weekSales - weekExpenses;

    const weekPrevSales = stats.weekPrev * price;
    const weekPrevExpenses = stats.weekPrev * directPerUnit + stats.kmWeekPrev * gasPerKm;
    const weekPrevProfit = weekPrevSales - weekPrevExpenses;

    // Mes actual y mes anterior (toma informe mensual si existe; si no, calcula con ventas/km)
    const curMonthData = reportDoc.months?.[curMonthKey]
      ? construirInformeMensual(curMonthKey, reportDoc.months[curMonthKey], costConfig)
      : null;

    const monthSales =
      curMonthData && curMonthData.garrafonesVendidos > 0
        ? curMonthData.ingresosEstimados
        : stats.monthTotal * price;
    const monthExpenses =
      curMonthData && curMonthData.garrafonesVendidos > 0
        ? curMonthData.costoTotal
        : stats.monthTotal * directPerUnit + stats.kmMonth * gasPerKm;
    const monthProfit = monthSales - monthExpenses;

    const prevMonthData = reportDoc.months?.[prevMonthKey]
      ? construirInformeMensual(prevMonthKey, reportDoc.months[prevMonthKey], costConfig)
      : null;

    const monthPrevSales =
      prevMonthData && prevMonthData.garrafonesVendidos > 0
        ? prevMonthData.ingresosEstimados
        : stats.monthPrev * price;
    const monthPrevExpenses =
      prevMonthData && prevMonthData.garrafonesVendidos > 0
        ? prevMonthData.costoTotal
        : stats.monthPrev * directPerUnit + stats.kmMonthPrev * gasPerKm;
    const monthPrevProfit = monthPrevSales - monthPrevExpenses;

    // Año actual y año anterior
    const sumYearFromReports = (yr: string) => {
      const entries = Object.entries(reportDoc.months || {})
        .filter(([k]) => k.startsWith(`${yr}-`))
        .map(([k, v]) => construirInformeMensual(k, v, costConfig));
      const gar = entries.reduce((a, e) => a + e.garrafonesVendidos, 0);
      return {
        gar,
        sales: entries.reduce((a, e) => a + e.ingresosEstimados, 0),
        expenses: entries.reduce((a, e) => a + e.costoTotal, 0),
        profit: entries.reduce((a, e) => a + e.utilidadNeta, 0)
      };
    };

    const curYrRep = sumYearFromReports(curYearKey);
    const yearSales = curYrRep.gar > 0 ? curYrRep.sales : stats.yearTotal * price;
    const yearExpenses =
      curYrRep.gar > 0
        ? curYrRep.expenses
        : stats.yearTotal * directPerUnit + stats.kmYear * gasPerKm;
    const yearProfit = yearSales - yearExpenses;

    const prevYrRep = sumYearFromReports(prevYearKey);
    const yearPrevSales = prevYrRep.gar > 0 ? prevYrRep.sales : stats.yearPrev * price;
    const yearPrevExpenses =
      prevYrRep.gar > 0
        ? prevYrRep.expenses
        : stats.yearPrev * directPerUnit + stats.kmYearPrev * gasPerKm;
    const yearPrevProfit = yearPrevSales - yearPrevExpenses;

    return {
      weekSales,
      weekExpenses,
      weekProfit,
      weekPrevProfit,
      monthSales,
      monthExpenses,
      monthProfit,
      monthPrevProfit,
      yearSales,
      yearExpenses,
      yearProfit,
      yearPrevProfit
    };
  });

  let unitCosts = $derived.by(() =>
    calcularCostosUnitarios({
      config: costConfig,
      maint,
      garrafonesPeriodo: stats.monthTotal || stats.weekTotal || 1,
      kmPeriodo: stats.kmMonth || stats.kmWeek || 0
    })
  );

  let availableMonths = $derived.by(() => {
    const keys = new Set<string>(Object.keys(reportDoc.months || {}));
    keys.add(selectedMonthKey);
    return Array.from(keys).sort().reverse();
  });

  let availableYears = $derived.by(() => {
    const years = new Set<string>([selectedYearKey]);
    for (const k of Object.keys(reportDoc.months || {})) {
      const y = k.split('-')[0];
      if (y) years.add(y);
    }
    return Array.from(years).sort().reverse();
  });

  let monthlyReport = $derived.by(() =>
    construirInformeMensual(
      selectedMonthKey,
      reportDoc.months?.[selectedMonthKey],
      costConfig
    )
  );

  let annualReport = $derived.by(() => {
    const entries = Object.entries(reportDoc.months || {})
      .filter(([k]) => k.startsWith(`${selectedYearKey}-`))
      .map(([k, v]) => construirInformeMensual(k, v, costConfig));

    const garrafonesVendidos = entries.reduce((acc, e) => acc + e.garrafonesVendidos, 0);
    const kmRecorridos = entries.reduce((acc, e) => acc + e.kmRecorridos, 0);
    const juegosFiltrosUsados = entries.reduce((acc, e) => acc + e.juegosFiltrosUsados, 0);
    const piezasFiltrosUsadas =
      juegosFiltrosUsados * (Number(costConfig.filtrosPorJuego) || 3);

    const osmosisFechasSet = new Set<string>();
    for (const e of entries) {
      for (const f of e.cambiosOsmosisFechas || []) {
        if (f) osmosisFechasSet.add(f);
      }
    }
    for (const item of reportDoc.osmosisDatesAllTime || []) {
      if (item.date?.startsWith(`${selectedYearKey}-`)) {
        osmosisFechasSet.add(item.date);
      }
    }

    const ingresosEstimados = entries.reduce((acc, e) => acc + e.ingresosEstimados, 0);
    const costoInsumosDirectos = entries.reduce((acc, e) => acc + e.costoInsumosDirectos, 0);
    const costoGasolina = entries.reduce((acc, e) => acc + e.costoGasolina, 0);
    const costoFiltros = entries.reduce((acc, e) => acc + e.costoFiltros, 0);
    const costoOsmosis = entries.reduce((acc, e) => acc + e.costoOsmosis, 0);
    const costoFijosProrrateados = entries.reduce((acc, e) => acc + e.costoFijosProrrateados, 0);
    const costoTotal = entries.reduce((acc, e) => acc + e.costoTotal, 0);
    const utilidadNeta = entries.reduce((acc, e) => acc + e.utilidadNeta, 0);

    return {
      yearKey: selectedYearKey,
      mesesRegistrados: entries.length,
      garrafonesVendidos,
      kmRecorridos,
      juegosFiltrosUsados,
      piezasFiltrosUsadas,
      cambiosOsmosisFechas: Array.from(osmosisFechasSet).sort(),
      ingresosEstimados,
      costoInsumosDirectos,
      costoGasolina,
      costoFiltros,
      costoOsmosis,
      costoFijosProrrateados,
      costoTotal,
      utilidadNeta
    };
  });

  function downloadReportFile() {
    const lines: string[] = [];
    if (reportMode === 'mensual') {
      const r = monthlyReport;
      lines.push(`INFORME MENSUAL PURIFICADORA (${r.monthKey})`);
      lines.push('----------------------------------------');
      lines.push(`Garrafones vendidos: ${r.garrafonesVendidos}`);
      lines.push(`Kilómetros recorridos: ${r.kmRecorridos.toFixed(1)} km`);
      lines.push(`Juegos de filtros usados (3 filtros c/u): ${r.juegosFiltrosUsados}`);
      lines.push(
        `Fechas cambio ósmosis: ${
          r.cambiosOsmosisFechas.length > 0 ? r.cambiosOsmosisFechas.join(', ') : 'Ninguno en el mes'
        }`
      );
      lines.push(`Ingresos estimados: ${formatMoney(r.ingresosEstimados)}`);
      lines.push(`Insumos directos (tapa/sello/jabón): ${formatMoney(r.costoInsumosDirectos)}`);
      lines.push(`Gasolina: ${formatMoney(r.costoGasolina)}`);
      lines.push(`Filtros: ${formatMoney(r.costoFiltros)}`);
      lines.push(`Ósmosis: ${formatMoney(r.costoOsmosis)}`);
      lines.push(`Fijos (luz/agua/tinacos): ${formatMoney(r.costoFijosProrrateados)}`);
      lines.push(`Costo total: ${formatMoney(r.costoTotal)}`);
      lines.push(`Utilidad neta estimada: ${formatMoney(r.utilidadNeta)}`);
    } else {
      const r = annualReport;
      lines.push(`INFORME ANUAL PURIFICADORA (${r.yearKey})`);
      lines.push('---------------------------------------');
      lines.push(`Garrafones vendidos: ${r.garrafonesVendidos}`);
      lines.push(`Kilómetros recorridos: ${r.kmRecorridos.toFixed(1)} km`);
      lines.push(
        `Juegos de filtros usados: ${r.juegosFiltrosUsados} (${r.piezasFiltrosUsadas} filtros individuales)`
      );
      lines.push(
        `Fechas cambio ósmosis: ${
          r.cambiosOsmosisFechas.length > 0 ? r.cambiosOsmosisFechas.join(', ') : 'Ninguno en el año'
        }`
      );
      lines.push(`Ingresos estimados: ${formatMoney(r.ingresosEstimados)}`);
      lines.push(`Insumos directos (tapa/sello/jabón): ${formatMoney(r.costoInsumosDirectos)}`);
      lines.push(`Gasolina: ${formatMoney(r.costoGasolina)}`);
      lines.push(`Filtros: ${formatMoney(r.costoFiltros)}`);
      lines.push(`Ósmosis: ${formatMoney(r.costoOsmosis)}`);
      lines.push(`Fijos (luz/agua/tinacos): ${formatMoney(r.costoFijosProrrateados)}`);
      lines.push(`Costo total: ${formatMoney(r.costoTotal)}`);
      lines.push(`Utilidad neta estimada: ${formatMoney(r.utilidadNeta)}`);
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download =
      reportMode === 'mensual'
        ? `informe-purificadora-${monthlyReport.monthKey}.txt`
        : `informe-anual-purificadora-${annualReport.yearKey}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }
</script>

<div class="space-y-6">
  <!-- Cabecera -->
  <div class="flex flex-col sm:flex-row justify-between items-center text-center sm:text-left gap-4 bg-slate-800/60 p-4 rounded-xl border border-slate-700">
    <div>
      <h2 class="text-xl font-bold text-cyan-300">⚙️ Mantenimiento de Equipos & Contabilidad</h2>
      <p class="text-xs text-slate-400">Supervisa tus sistemas de purificación, costos reales por garrafón e informes.</p>
    </div>
    <button
      type="button"
      onclick={() => (showCostEditor = !showCostEditor)}
      class="w-full sm:w-auto bg-slate-900 hover:bg-slate-950 text-cyan-300 border border-cyan-700/60 font-bold px-4 py-2.5 rounded-lg text-xs transition-colors cursor-pointer"
    >
      {showCostEditor ? '✖ Cerrar Tarifas' : '💲 Configurar Costos y Tarifas'}
    </button>
  </div>

  <!-- Editor de Parámetros de Costos -->
  {#if showCostEditor}
    <div class="bg-slate-900/90 border border-cyan-800/60 rounded-xl p-5 space-y-4 shadow-xl">
      <div>
        <h3 class="font-bold text-cyan-300 text-base">💲 Parámetros Base de Producción y Reparto</h3>
        <p class="text-xs text-slate-400">Ajusta precios unitarios o rendimientos cuando cambien tus insumos.</p>
      </div>

      <form onsubmit={saveCostConfig} class="space-y-4 text-xs">
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div class="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-1">
            <label class="block text-slate-400 font-semibold">Precio Promedio Garrafón ($)</label>
            <input type="number" step="0.01" min="0" bind:value={costConfig.precioGarrafon} disabled={savingCosts} class="w-full bg-slate-900 border border-slate-700 rounded p-2 text-slate-100" />
          </div>
          <div class="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-1">
            <label class="block text-slate-400 font-semibold">Tapa con Liner c/u ($)</label>
            <input type="number" step="0.01" min="0" bind:value={costConfig.costoTapa} disabled={savingCosts} class="w-full bg-slate-900 border border-slate-700 rounded p-2 text-slate-100" />
          </div>
          <div class="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-1">
            <label class="block text-slate-400 font-semibold">Sello Termoencogible c/u ($)</label>
            <input type="number" step="0.01" min="0" bind:value={costConfig.costoSello} disabled={savingCosts} class="w-full bg-slate-900 border border-slate-700 rounded p-2 text-slate-100" />
          </div>
          <div class="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-1">
            <label class="block text-slate-400 font-semibold">Jabón y Cloro / Garrafón ($)</label>
            <input type="number" step="0.01" min="0" bind:value={costConfig.costoJabonCloro} disabled={savingCosts} class="w-full bg-slate-900 border border-slate-700 rounded p-2 text-slate-100" />
          </div>
          <div class="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-1">
            <label class="block text-slate-400 font-semibold">Rendimiento Carro (km/L)</label>
            <input type="number" step="0.1" min="1" bind:value={costConfig.rendimientoKmPorLitro} disabled={savingCosts} class="w-full bg-slate-900 border border-slate-700 rounded p-2 text-slate-100" />
          </div>
          <div class="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-1">
            <label class="block text-slate-400 font-semibold">Precio Gasolina / Litro ($)</label>
            <input type="number" step="0.01" min="0" bind:value={costConfig.precioGasolinaLitro} disabled={savingCosts} class="w-full bg-slate-900 border border-slate-700 rounded p-2 text-slate-100" />
          </div>
          <div class="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-1">
            <label class="block text-slate-400 font-semibold">Juego de 3 Filtros ($)</label>
            <input type="number" step="0.01" min="0" bind:value={costConfig.costoJuegoFiltros} disabled={savingCosts} class="w-full bg-slate-900 border border-slate-700 rounded p-2 text-slate-100" />
          </div>
          <div class="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-1">
            <label class="block text-slate-400 font-semibold">Membrana Ósmosis c/u ($)</label>
            <input type="number" step="0.01" min="0" bind:value={costConfig.costoMembranaUnitaria} disabled={savingCosts} class="w-full bg-slate-900 border border-slate-700 rounded p-2 text-slate-100" />
          </div>
          <div class="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-1">
            <label class="block text-slate-400 font-semibold">Cantidad de Membranas</label>
            <input type="number" min="1" bind:value={costConfig.cantidadMembranas} disabled={savingCosts} class="w-full bg-slate-900 border border-slate-700 rounded p-2 text-slate-100" />
          </div>
        </div>

        <div class="flex justify-end">
          <button
            type="submit"
            disabled={savingCosts}
            class="bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 text-slate-950 font-bold px-5 py-2 rounded-lg cursor-pointer"
          >
            {savingCosts ? 'Guardando...' : 'Guardar Tarifas'}
          </button>
        </div>
      </form>
    </div>
  {/if}

  {#if loading}
    <div class="text-center py-12 text-slate-400 animate-pulse">Cargando registros...</div>
  {:else}
    <!-- SECCIÓN 1: CONTABILIDAD DE VENTAS (VOLUMEN) -->
    <div class="space-y-3">
      <h3 class="font-bold text-slate-200 text-sm text-center sm:text-left">📊 Balance de Garrafones Vendidos</h3>
      
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div class="bg-slate-800/80 border border-slate-700 p-4 rounded-xl text-center space-y-1 shadow-md min-w-0">
          <span class="text-xs text-slate-400 uppercase font-semibold">Semana Actual</span>
          <div class="text-3xl font-black text-cyan-400">{stats.weekTotal}</div>
          <span class="text-[11px] text-slate-500 block">Garrafones Vendidos · {stats.kmWeek.toFixed(1)} km</span>
          <div class="pt-1 border-t border-slate-700/70 text-[11px] text-slate-400">
            Semana anterior: <strong class="text-slate-200">{stats.weekPrev}</strong>
          </div>
        </div>

        <div class="bg-slate-800/80 border border-slate-700 p-4 rounded-xl text-center space-y-1 shadow-md min-w-0">
          <span class="text-xs text-slate-400 uppercase font-semibold">Mes Actual</span>
          <div class="text-3xl font-black text-cyan-300">{stats.monthTotal}</div>
          <span class="text-[11px] text-slate-500 block">Garrafones Vendidos · {stats.kmMonth.toFixed(1)} km</span>
          <div class="pt-1 border-t border-slate-700/70 text-[11px] text-slate-400">
            Mes anterior: <strong class="text-slate-200">{stats.monthPrev}</strong>
          </div>
        </div>

        <div class="bg-slate-800/80 border border-slate-700 p-4 rounded-xl text-center space-y-1 shadow-md min-w-0">
          <span class="text-xs text-slate-400 uppercase font-semibold">Año Actual</span>
          <div class="text-3xl font-black text-emerald-400">{stats.yearTotal}</div>
          <span class="text-[11px] text-slate-500 block">Garrafones Vendidos · {stats.kmYear.toFixed(1)} km</span>
          <div class="pt-1 border-t border-slate-700/70 text-[11px] text-slate-400">
            Año anterior: <strong class="text-slate-200">{stats.yearPrev}</strong>
          </div>
        </div>
      </div>
    </div>

    <!-- SECCIÓN 1B: RESUMEN DE DINERO (VENTAS - GASTOS = GANANCIA) -->
    <div class="space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2 text-center sm:text-left">
        <h3 class="font-bold text-slate-200 text-sm">💰 Resumen Financiero (Ventas − Gastos = Ganancia)</h3>
        <span class="text-[11px] text-slate-400">Descuenta insumos directos, gasolina y mantenimientos registrados</span>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <!-- Semana -->
        <div class="bg-slate-800/80 border border-emerald-800/40 p-4 rounded-xl text-center space-y-1.5 shadow-md min-w-0">
          <span class="text-xs text-slate-400 uppercase font-semibold">Ganancia Semana</span>
          <div class="text-2xl sm:text-3xl font-black {moneySummary.weekProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}">
            {formatMoney(moneySummary.weekProfit)}
          </div>
          <p class="text-[11px] text-slate-300">
            Ventas <strong class="text-cyan-300">{formatMoney(moneySummary.weekSales)}</strong> − Gastos <strong class="text-amber-300">{formatMoney(moneySummary.weekExpenses)}</strong>
          </p>
          <div class="pt-1 border-t border-slate-700/70 text-[11px] text-slate-400">
            Semana anterior: <strong class="text-slate-200">{formatMoney(moneySummary.weekPrevProfit)}</strong>
          </div>
        </div>

        <!-- Mes -->
        <div class="bg-slate-800/80 border border-emerald-700/60 p-4 rounded-xl text-center space-y-1.5 shadow-md min-w-0">
          <span class="text-xs text-slate-400 uppercase font-semibold">Ganancia Mes</span>
          <div class="text-2xl sm:text-3xl font-black {moneySummary.monthProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}">
            {formatMoney(moneySummary.monthProfit)}
          </div>
          <p class="text-[11px] text-slate-300">
            Ventas <strong class="text-cyan-300">{formatMoney(moneySummary.monthSales)}</strong> − Gastos <strong class="text-amber-300">{formatMoney(moneySummary.monthExpenses)}</strong>
          </p>
          <div class="pt-1 border-t border-slate-700/70 text-[11px] text-slate-400">
            Mes anterior: <strong class="text-slate-200">{formatMoney(moneySummary.monthPrevProfit)}</strong>
          </div>
        </div>

        <!-- Año -->
        <div class="bg-slate-800/80 border border-emerald-800/40 p-4 rounded-xl text-center space-y-1.5 shadow-md min-w-0">
          <span class="text-xs text-slate-400 uppercase font-semibold">Ganancia Año</span>
          <div class="text-2xl sm:text-3xl font-black {moneySummary.yearProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}">
            {formatMoney(moneySummary.yearProfit)}
          </div>
          <p class="text-[11px] text-slate-300">
            Ventas <strong class="text-cyan-300">{formatMoney(moneySummary.yearSales)}</strong> − Gastos <strong class="text-amber-300">{formatMoney(moneySummary.yearExpenses)}</strong>
          </p>
          <div class="pt-1 border-t border-slate-700/70 text-[11px] text-slate-400">
            Año anterior: <strong class="text-slate-200">{formatMoney(moneySummary.yearPrevProfit)}</strong>
          </div>
        </div>
      </div>
    </div>

    <!-- SECCIÓN 2: COSTO REAL POR GARRAFÓN Y RENTABILIDAD -->
    <div class="bg-slate-800/70 border border-cyan-800/40 rounded-xl p-5 space-y-4">
      <div class="flex flex-col sm:flex-row justify-between items-center gap-2 text-center sm:text-left">
        <div>
          <h3 class="font-bold text-cyan-300 text-base">🧮 Costo Real de Producción y Reparto por Garrafón</h3>
          <p class="text-xs text-slate-400">Precio promedio de venta: <strong class="text-slate-200">{formatMoney(costConfig.precioGarrafon)}</strong> · Ciclo filtros: <strong class="text-cyan-300">{maint.garrafonesDesdeFiltros}</strong> garrafones · Ciclo ósmosis: <strong class="text-cyan-300">{maint.garrafonesDesdeMembrana}</strong> garrafones</p>
        </div>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div class="bg-slate-900/90 border border-slate-700 p-3 rounded-lg">
          <span class="text-slate-400 block">Costo Real / Garrafón</span>
          <strong class="text-amber-300 text-lg font-black">{formatMoney(unitCosts.costoUnitarioReal)}</strong>
        </div>
        <div class="bg-slate-900/90 border border-slate-700 p-3 rounded-lg">
          <span class="text-slate-400 block">Utilidad Neta / Garrafón</span>
          <strong class="{unitCosts.utilidadUnitaria >= 0 ? 'text-emerald-400' : 'text-rose-400'} text-lg font-black">{formatMoney(unitCosts.utilidadUnitaria)}</strong>
        </div>
        <div class="bg-slate-900/90 border border-slate-700 p-3 rounded-lg">
          <span class="text-slate-400 block">Tapa + Sello + Jabón</span>
          <strong class="text-slate-200 text-base font-bold">{formatMoney(unitCosts.insumosPorGarrafon)}</strong>
          <span class="text-[10px] text-slate-500 block">({formatMoney(costConfig.costoTapa)} + {formatMoney(costConfig.costoSello)} + {formatMoney(costConfig.costoJabonCloro)})</span>
        </div>
        <div class="bg-slate-900/90 border border-slate-700 p-3 rounded-lg">
          <span class="text-slate-400 block">Gasolina / Filtros / Ósmosis</span>
          <strong class="text-cyan-300 text-xs font-bold block mt-0.5">
            ⛽ {formatMoney(unitCosts.gasolinaPorGarrafon)} · 🧪 {formatMoney(unitCosts.filtrosPorGarrafon)} · 💧 {formatMoney(unitCosts.osmosisPorGarrafon)}
          </strong>
        </div>
      </div>
    </div>

    <!-- SECCIÓN 3: MANTENIMIENTO DE EQUIPOS -->
    <div class="bg-slate-800/60 border border-slate-700 rounded-xl p-5 space-y-4 min-w-0 overflow-hidden">
      <div class="text-center sm:text-left">
        <h3 class="font-bold text-cyan-300 text-base">🛠️ Mantenimiento de Sistemas de Purificación</h3>
        <p class="text-xs text-slate-400">Al cambiar la fecha de filtros o membranas y guardar, se actualiza el ciclo y se registra en tu informe.</p>
      </div>

      <form onsubmit={saveMaintenance} class="space-y-4 text-sm min-w-0">
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 min-w-0">
          <div class="bg-slate-900/80 p-3 rounded-lg border border-slate-700 space-y-2 min-w-0 overflow-hidden">
            <label class="block text-xs font-bold text-slate-300">🚿 Último Lavado de Tinacos</label>
            <input type="date" bind:value={maint.lastTinacos} disabled={saving} class="w-full min-w-0 max-w-full box-border bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-100 text-xs focus:border-cyan-400 focus:outline-none" />
          </div>

          <div class="bg-slate-900/80 p-3 rounded-lg border border-slate-700 space-y-2 min-w-0 overflow-hidden">
            <label class="block text-xs font-bold text-slate-300">🔄 Último Cambio de Filtros</label>
            <input type="date" bind:value={maint.lastFiltros} disabled={saving} class="w-full min-w-0 max-w-full box-border bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-100 text-xs focus:border-cyan-400 focus:outline-none" />
            <span class="text-[11px] text-slate-400 block">Juegos ocupados acumulados: <strong class="text-cyan-300">{maint.juegosFiltrosUsadosTotal}</strong></span>
          </div>

          <div class="bg-slate-900/80 p-3 rounded-lg border border-slate-700 space-y-2 min-w-0 overflow-hidden">
            <label class="block text-xs font-bold text-slate-300">💧 Membrana Ósmosis Inversa</label>
            <input type="date" bind:value={maint.lastMembrana} disabled={saving} class="w-full min-w-0 max-w-full box-border bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-100 text-xs focus:border-cyan-400 focus:outline-none" />
            <span class="text-[11px] text-slate-400 block">Cambios registrados: <strong class="text-emerald-300">{maint.cambiosOsmosisHistorial.length}</strong></span>
          </div>
        </div>

        <div class="flex justify-center sm:justify-end pt-2">
          <button 
            type="submit" 
            disabled={saving}
            class="w-full sm:w-auto bg-cyan-500 hover:bg-cyan-600 text-slate-950 font-bold px-6 py-2.5 rounded-xl transition-colors shadow-lg text-sm cursor-pointer disabled:opacity-50"
          >
            {saving ? 'Guardando...' : '💾 Guardar Fechas de Mantenimiento'}
          </button>
        </div>
      </form>
    </div>

    <!-- SECCIÓN 4: INFORME MENSUAL Y ANUAL -->
    <div class="bg-slate-800/70 border border-slate-700 rounded-xl p-5 space-y-4">
      <div class="flex flex-col sm:flex-row justify-between items-center gap-3">
        <div class="text-center sm:text-left">
          <h3 class="font-bold text-cyan-300 text-base">📑 Informes Mensual y Anual</h3>
          <p class="text-xs text-slate-400">Consulta o descarga el resumen con fechas de cambio de ósmosis y total de filtros usados.</p>
        </div>

        <div class="flex flex-wrap items-center justify-center gap-2 text-xs">
          <button
            type="button"
            onclick={() => (reportMode = 'mensual')}
            class="px-3 py-1.5 rounded-lg font-bold border cursor-pointer {reportMode === 'mensual'
              ? 'bg-cyan-500 text-slate-950 border-cyan-400'
              : 'bg-slate-900 text-slate-300 border-slate-700'}"
          >
            Mensual
          </button>
          <button
            type="button"
            onclick={() => (reportMode = 'anual')}
            class="px-3 py-1.5 rounded-lg font-bold border cursor-pointer {reportMode === 'anual'
              ? 'bg-cyan-500 text-slate-950 border-cyan-400'
              : 'bg-slate-900 text-slate-300 border-slate-700'}"
          >
            Anual
          </button>

          {#if reportMode === 'mensual'}
            <select bind:value={selectedMonthKey} class="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100">
              {#each availableMonths as mKey}
                <option value={mKey}>{mKey}</option>
              {/each}
            </select>
          {:else}
            <select bind:value={selectedYearKey} class="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100">
              {#each availableYears as yKey}
                <option value={yKey}>{yKey}</option>
              {/each}
            </select>
          {/if}

          <button
            type="button"
            onclick={downloadReportFile}
            class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3.5 py-1.5 rounded-lg cursor-pointer"
          >
            ⬇️ Descargar Informe
          </button>
        </div>
      </div>

      {#if reportMode === 'mensual'}
        <div class="bg-slate-900/90 border border-slate-700/80 rounded-xl p-4 space-y-3 text-xs">
          <div class="flex flex-wrap justify-between items-center gap-2 border-b border-slate-800 pb-2">
            <strong class="text-cyan-300 text-sm">Resumen Mensual: {monthlyReport.monthKey}</strong>
            <span class="text-emerald-400 font-bold">Utilidad neta: {formatMoney(monthlyReport.utilidadNeta)}</span>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div><span class="text-slate-400 block">Garrafones:</span><strong class="text-slate-100">{monthlyReport.garrafonesVendidos}</strong></div>
            <div><span class="text-slate-400 block">Km recorridos:</span><strong class="text-slate-100">{monthlyReport.kmRecorridos.toFixed(1)} km</strong></div>
            <div><span class="text-slate-400 block">Juegos filtros usados:</span><strong class="text-cyan-300">{monthlyReport.juegosFiltrosUsados}</strong></div>
            <div><span class="text-slate-400 block">Ingresos / Costos:</span><strong class="text-slate-100">{formatMoney(monthlyReport.ingresosEstimados)} / {formatMoney(monthlyReport.costoTotal)}</strong></div>
          </div>
          <div class="pt-2 border-t border-slate-800 text-slate-300">
            <span class="text-slate-400">Fechas de cambio de ósmosis en el mes:</span>
            <strong class="text-emerald-300 ml-1">
              {monthlyReport.cambiosOsmosisFechas.length > 0
                ? monthlyReport.cambiosOsmosisFechas.join(', ')
                : 'Sin cambios registrados'}
            </strong>
          </div>
        </div>
      {:else}
        <div class="bg-slate-900/90 border border-slate-700/80 rounded-xl p-4 space-y-3 text-xs">
          <div class="flex flex-wrap justify-between items-center gap-2 border-b border-slate-800 pb-2">
            <strong class="text-cyan-300 text-sm">Resumen Anual: {annualReport.yearKey}</strong>
            <span class="text-emerald-400 font-bold">Utilidad neta anual: {formatMoney(annualReport.utilidadNeta)}</span>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div><span class="text-slate-400 block">Garrafones año:</span><strong class="text-slate-100">{annualReport.garrafonesVendidos}</strong></div>
            <div><span class="text-slate-400 block">Km recorridos año:</span><strong class="text-slate-100">{annualReport.kmRecorridos.toFixed(1)} km</strong></div>
            <div><span class="text-slate-400 block">Filtros usados (juegos):</span><strong class="text-cyan-300">{annualReport.juegosFiltrosUsados} ({annualReport.piezasFiltrosUsadas} filtros)</strong></div>
            <div><span class="text-slate-400 block">Ingresos / Costos:</span><strong class="text-slate-100">{formatMoney(annualReport.ingresosEstimados)} / {formatMoney(annualReport.costoTotal)}</strong></div>
          </div>
          <div class="pt-2 border-t border-slate-800 text-slate-300">
            <span class="text-slate-400">Fechas de cambio de membranas de ósmosis en {annualReport.yearKey}:</span>
            <strong class="text-emerald-300 ml-1">
              {annualReport.cambiosOsmosisFechas.length > 0
                ? annualReport.cambiosOsmosisFechas.join(', ')
                : 'Sin cambios registrados'}
            </strong>
          </div>
        </div>
      {/if}
    </div>

    <!-- SECCIÓN 5: MAPA DE CALOR BAJO DEMANDA -->
    <div class="bg-slate-800/60 border border-slate-700 rounded-xl p-5 space-y-4">
      <div class="flex flex-col sm:flex-row justify-between items-center gap-3 text-center sm:text-left">
        <div>
          <h3 class="font-bold text-cyan-300 text-base">🗺️ Mapa de Calor de Clientes y Demanda</h3>
          <p class="text-xs text-slate-400">Visualiza bajo demanda en qué zonas se concentran tus clientes y garrafones habituales.</p>
        </div>

        <div class="flex items-center gap-2 w-full sm:w-auto justify-center">
          {#if showHeatmap}
            <button
              type="button"
              onclick={() => toggleHeatmap(true)}
              disabled={loadingHeatmapClients}
              class="bg-slate-900 hover:bg-slate-950 text-cyan-300 border border-slate-700 font-semibold px-3 py-2 rounded-lg text-xs transition-colors cursor-pointer disabled:opacity-50"
            >
              🔄 Actualizar
            </button>
          {/if}
          <button
            type="button"
            onclick={() => toggleHeatmap(false)}
            disabled={loadingHeatmapClients}
            class="w-full sm:w-auto bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-bold px-4 py-2.5 rounded-lg text-xs transition-colors shadow cursor-pointer"
          >
            {showHeatmap ? '▲ Ocultar Mapa' : '🔥 Generar Mapa de Calor'}
          </button>
        </div>
      </div>

      {#if showHeatmap}
        {#if loadingHeatmapClients}
          <div class="text-center py-8 text-slate-400 animate-pulse text-xs">
            Cargando ubicaciones de clientes...
          </div>
        {:else}
          <HeatmapClientes clients={heatmapClients} />
        {/if}
      {/if}
    </div>
  {/if}
</div>