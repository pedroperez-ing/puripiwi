import type {
  CostConfig,
  MaintenanceState,
  MonthlyLedgerItem
} from '$lib/types/purificadora';

export const DEFAULT_COST_CONFIG: CostConfig = {
  precioGarrafon: 21,
  costoTapa: 0.34,
  costoSello: 0.3,
  costoJabonCloro: 0.4,
  rendimientoKmPorLitro: 15,
  precioGasolinaLitro: 25,
  costoJuegoFiltros: 110,
  filtrosPorJuego: 3,
  costoMembranaUnitaria: 1000,
  cantidadMembranas: 2,
  costoLavadoTinacos: 0,
  costoLuzMensual: 0,
  costoAguaMensual: 0
};

export const DEFAULT_MAINTENANCE_STATE: MaintenanceState = {
  lastTinacos: '',
  lastFiltros: '',
  lastMembrana: '',
  garrafonesDesdeFiltros: 0,
  garrafonesDesdeMembrana: 0,
  juegosFiltrosUsadosTotal: 0,
  cambiosOsmosisHistorial: []
};

export function calcularCostosUnitarios(params: {
  config: CostConfig;
  maint: MaintenanceState;
  garrafonesPeriodo: number;
  kmPeriodo: number;
}) {
  const cfg = { ...DEFAULT_COST_CONFIG, ...params.config };
  const garrafones = Math.max(0, Number(params.garrafonesPeriodo) || 0);
  const km = Math.max(0, Number(params.kmPeriodo) || 0);

  const insumosPorGarrafon =
    (Number(cfg.costoTapa) || 0) +
    (Number(cfg.costoSello) || 0) +
    (Number(cfg.costoJabonCloro) || 0);

  const litrosGasolina =
    (Number(cfg.rendimientoKmPorLitro) || 0) > 0
      ? km / Number(cfg.rendimientoKmPorLitro)
      : 0;
  const costoGasolinaTotal = litrosGasolina * (Number(cfg.precioGasolinaLitro) || 0);
  const gasolinaPorGarrafon = garrafones > 0 ? costoGasolinaTotal / garrafones : 0;

  const baseGarrafonesFiltros = Math.max(
    Number(params.maint.garrafonesDesdeFiltros) || 0,
    garrafones
  );
  const filtrosPorGarrafon =
    baseGarrafonesFiltros > 0
      ? (Number(cfg.costoJuegoFiltros) || 0) / baseGarrafonesFiltros
      : 0;

  const costoTotalOsmosis =
    (Number(cfg.costoMembranaUnitaria) || 0) * (Number(cfg.cantidadMembranas) || 2);
  const baseGarrafonesOsmosis = Math.max(
    Number(params.maint.garrafonesDesdeMembrana) || 0,
    garrafones
  );
  const osmosisPorGarrafon =
    baseGarrafonesOsmosis > 0 ? costoTotalOsmosis / baseGarrafonesOsmosis : 0;

  const fijosMensuales =
    (Number(cfg.costoLuzMensual) || 0) +
    (Number(cfg.costoAguaMensual) || 0) +
    (Number(cfg.costoLavadoTinacos) || 0);
  const fijosPorGarrafon = garrafones > 0 ? fijosMensuales / garrafones : 0;

  const costoUnitarioReal =
    insumosPorGarrafon +
    gasolinaPorGarrafon +
    filtrosPorGarrafon +
    osmosisPorGarrafon +
    fijosPorGarrafon;

  const precioVenta = Number(cfg.precioGarrafon) || 21;
  const utilidadUnitaria = precioVenta - costoUnitarioReal;
  const ingresosTotales = garrafones * precioVenta;
  const costoTotalPeriodo = garrafones * costoUnitarioReal;
  const utilidadNetaPeriodo = ingresosTotales - costoTotalPeriodo;

  return {
    insumosPorGarrafon,
    gasolinaPorGarrafon,
    filtrosPorGarrafon,
    osmosisPorGarrafon,
    fijosPorGarrafon,
    costoUnitarioReal,
    utilidadUnitaria,
    ingresosTotales,
    costoTotalPeriodo,
    utilidadNetaPeriodo,
    litrosGasolina,
    costoGasolinaTotal,
    costoTotalOsmosis
  };
}

export function construirInformeMensual(
  monthKey: string,
  record: MonthlyLedgerItem | undefined,
  config: CostConfig
): MonthlyLedgerItem {
  const cfg = { ...DEFAULT_COST_CONFIG, ...config };
  const garrafonesVendidos = Number(record?.garrafonesVendidos) || 0;
  const kmRecorridos = Number(record?.kmRecorridos) || 0;
  const juegosFiltrosUsados = Number(record?.juegosFiltrosUsados) || 0;
  const cambiosOsmosisFechas = Array.isArray(record?.cambiosOsmosisFechas)
    ? record.cambiosOsmosisFechas
    : [];

  const ingresosEstimados = garrafonesVendidos * (Number(cfg.precioGarrafon) || 21);
  const costoInsumosDirectos =
    garrafonesVendidos *
    ((Number(cfg.costoTapa) || 0) +
      (Number(cfg.costoSello) || 0) +
      (Number(cfg.costoJabonCloro) || 0));

  const litros =
    (Number(cfg.rendimientoKmPorLitro) || 0) > 0
      ? kmRecorridos / Number(cfg.rendimientoKmPorLitro)
      : 0;
  const costoGasolina = litros * (Number(cfg.precioGasolinaLitro) || 0);
  const costoFiltros = juegosFiltrosUsados * (Number(cfg.costoJuegoFiltros) || 110);
  const costoOsmosis =
    cambiosOsmosisFechas.length *
    ((Number(cfg.costoMembranaUnitaria) || 1000) * (Number(cfg.cantidadMembranas) || 2));
  const costoFijosProrrateados =
    (Number(cfg.costoLuzMensual) || 0) +
    (Number(cfg.costoAguaMensual) || 0) +
    (Number(cfg.costoLavadoTinacos) || 0);

  const costoTotal =
    costoInsumosDirectos +
    costoGasolina +
    costoFiltros +
    costoOsmosis +
    costoFijosProrrateados;

  const utilidadNeta = ingresosEstimados - costoTotal;

  return {
    monthKey,
    garrafonesVendidos,
    kmRecorridos,
    juegosFiltrosUsados,
    cambiosOsmosisFechas,
    ingresosEstimados,
    costoInsumosDirectos,
    costoGasolina,
    costoFiltros,
    costoOsmosis,
    costoFijosProrrateados,
    costoTotal,
    utilidadNeta
  };
}