export interface CostConfig {
  precioGarrafon: number;
  costoTapa: number;
  costoSello: number;
  costoJabonCloro: number;
  rendimientoKmPorLitro: number;
  precioGasolinaLitro: number;
  costoJuegoFiltros: number;
  filtrosPorJuego: number;
  costoMembranaUnitaria: number;
  cantidadMembranas: number;
  costoLavadoTinacos: number;
  costoLuzMensual: number;
  costoAguaMensual: number;
}

export interface OsmosisChangeRecord {
  date: string;
  garrafonesCicloAnterior: number;
}

export interface MaintenanceState {
  lastTinacos: string;
  lastFiltros: string;
  lastMembrana: string;
  garrafonesDesdeFiltros: number;
  garrafonesDesdeMembrana: number;
  juegosFiltrosUsadosTotal: number;
  cambiosOsmosisHistorial: OsmosisChangeRecord[];
}

export interface SalesCounters {
  semanaActual: number;
  semanaAnterior: number;
  weekKey?: string;
  mesActual: number;
  mesAnterior: number;
  monthKey?: string;
  anioActual: number;
  anioAnterior: number;
  yearKey?: string;
  kmSemanaActual?: number;
  kmSemanaAnterior?: number;
  kmMesActual?: number;
  kmMesAnterior?: number;
  kmAnioActual?: number;
  kmAnioAnterior?: number;
}

export interface MonthlyLedgerItem {
  monthKey: string;
  garrafonesVendidos: number;
  kmRecorridos: number;
  juegosFiltrosUsados: number;
  cambiosOsmosisFechas: string[];
  ingresosEstimados: number;
  costoInsumosDirectos: number;
  costoGasolina: number;
  costoFiltros: number;
  costoOsmosis: number;
  costoFijosProrrateados: number;
  costoTotal: number;
  utilidadNeta: number;
}

export interface AccountingReportDoc {
  months: Record<string, MonthlyLedgerItem>;
  osmosisDatesAllTime: OsmosisChangeRecord[];
  totalFiltrosAllTime: number;
}