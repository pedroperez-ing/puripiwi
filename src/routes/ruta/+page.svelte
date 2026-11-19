<script lang="ts">
  import { onMount } from 'svelte';
  import { db } from '$lib/firebase';
  import { collection, getDocs, getDoc, setDoc, deleteDoc, doc, updateDoc, addDoc, serverTimestamp } from 'firebase/firestore';

  interface Client {
    id: string;
    name: string;
    phone: string;
    address: string;
    mapLink: string;
    lat?: number | null;
    lng?: number | null;
    defaultGarafones: number;
    garrafonesHistory?: number[];
    prestados: number;
    rotos: number;
    frecuenciaDias: number;
    lastDelivery: string;
    history: string[];
  }

  interface Order {
    id: string;
    clientId: string;
    clientName: string;
    clientPhone?: string;
    address: string;
    mapLink: string;
    garafones: number;
    status: 'pendiente' | 'entregado';
    createdAt: any;
  }

  const BASE_COORDS = { lat: 19.506519, lng: -99.015168 };

  let orders = $state<Order[]>([]);
  let clients = $state<Client[]>([]);
  let loading = $state(true);
  let showNewOrderModal = $state(false);
  let selectedClientId = $state('');
  let customGarafones = $state(2);

  // Estados para el Modal de "Doble Check" de Entrega y Envases Rotos
  let showDeliverModal = $state(false);
  let orderToDeliver = $state<Order | null>(null);
  let emptyReturned = $state(0); // Buenos devueltos
  let brokenReturned = $state(0); // Rotos devueltos en la misma visita

  onMount(async () => {
    await fetchData();
  });

  async function fetchData() {
    try {
      loading = true;
      const clientSnap = await getDocs(collection(db, 'clients'));
      clients = clientSnap.docs.map(d => ({ id: d.id, ...d.data() })) as Client[];

      const orderSnap = await getDocs(collection(db, 'orders'));
      orders = orderSnap.docs.map(d => ({ id: d.id, ...d.data() })) as Order[];
    } catch (error) {
      console.error('Error al cargar datos de ruta:', error);
    } finally {
      loading = false;
    }
  }

  // Clave del lunes de la semana actual en hora local (YYYY-MM-DD)
  function getWeekMondayKey(date: Date): string {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day; // Lunes como inicio de semana
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

  // Actualiza el documento único stats/ventas sin acumular registros históricos
  async function updateSalesCounter(garafonesSold: number) {
    const now = new Date();
    const curWeek = getWeekMondayKey(now);
    const prevWeek = getPrevWeekMondayKey(now);
    const curMonth = getMonthKey(now);
    const prevMonth = getPrevMonthKey(now);
    const curYear = getYearKey(now);
    const prevYear = getPrevYearKey(now);

    const statsRef = doc(db, 'stats', 'ventas');
    const snap = await getDoc(statsRef);
    const data = snap.exists() ? snap.data() : {};

    let semanaActual = Number(data.semanaActual) || 0;
    let semanaAnterior = Number(data.semanaAnterior) || 0;
    const savedWeek = data.weekKey || '';

    if (savedWeek === curWeek) {
      semanaActual += garafonesSold;
    } else if (savedWeek === prevWeek) {
      semanaAnterior = semanaActual;
      semanaActual = garafonesSold;
    } else {
      semanaAnterior = 0;
      semanaActual = garafonesSold;
    }

    let mesActual = Number(data.mesActual) || 0;
    let mesAnterior = Number(data.mesAnterior) || 0;
    const savedMonth = data.monthKey || '';

    if (savedMonth === curMonth) {
      mesActual += garafonesSold;
    } else if (savedMonth === prevMonth) {
      mesAnterior = mesActual;
      mesActual = garafonesSold;
    } else {
      mesAnterior = 0;
      mesActual = garafonesSold;
    }

    let anioActual = Number(data.anioActual) || 0;
    let anioAnterior = Number(data.anioAnterior) || 0;
    const savedYear = data.yearKey || '';

    if (savedYear === curYear) {
      anioActual += garafonesSold;
    } else if (savedYear === prevYear) {
      anioAnterior = anioActual;
      anioActual = garafonesSold;
    } else {
      anioAnterior = 0;
      anioActual = garafonesSold;
    }

    await setDoc(statsRef, {
      semanaActual,
      semanaAnterior,
      weekKey: curWeek,
      mesActual,
      mesAnterior,
      monthKey: curMonth,
      anioActual,
      anioAnterior,
      yearKey: curYear
    });
  }

  async function handleCreateOrder(e: Event) {
    e.preventDefault();
    if (!selectedClientId) return;

    const client = clients.find(c => c.id === selectedClientId);
    if (!client) return;

    try {
      await addDoc(collection(db, 'orders'), {
        clientId: client.id,
        clientName: client.name,
        clientPhone: client.phone || '',
        address: client.address || 'Sin dirección',
        mapLink: client.mapLink || '',
        garafones: Number(customGarafones),
        status: 'pendiente',
        createdAt: serverTimestamp()
      });

      showNewOrderModal = false;
      selectedClientId = '';
      customGarafones = 2;
      await fetchData();
    } catch (error) {
      console.error('Error al crear pedido:', error);
      alert('Error al registrar el pedido.');
    }
  }

  // Obtener teléfono del pedido o del perfil del cliente
  function getOrderPhone(order: Order): string {
    if (order.clientPhone) return order.clientPhone;
    const found = clients.find(c => c.id === order.clientId);
    return found?.phone || '';
  }

  function getClientCoords(order: Order): { lat: number; lng: number } | null {
    const found = clients.find(c => c.id === order.clientId);
    if (found && typeof found.lat === 'number' && typeof found.lng === 'number') {
      return { lat: found.lat, lng: found.lng };
    }
    return null;
  }

  // Distancia Manhattan en kilómetros (suma de catetos N-S + E-O)
  function manhattanKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    const cosLat = Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
    const dLatKm = Math.abs(a.lat - b.lat) * 111.32;
    const dLngKm = Math.abs(a.lng - b.lng) * 111.32 * cosLat;
    return dLatKm + dLngKm;
  }

  function calcClosedLoopKm(stops: { order: Order; coords: { lat: number; lng: number } }[]): number {
    if (stops.length === 0) return 0;
    let total = manhattanKm(BASE_COORDS, stops[0].coords);
    for (let i = 0; i < stops.length - 1; i++) {
      total += manhattanKm(stops[i].coords, stops[i + 1].coords);
    }
    total += manhattanKm(stops[stops.length - 1].coords, BASE_COORDS);
    return total;
  }

  function getOptimalRouteOrders(list: Order[]): Order[] {
    const withCoords: { order: Order; coords: { lat: number; lng: number } }[] = [];
    const withoutCoords: Order[] = [];

    for (const o of list) {
      const c = getClientCoords(o);
      if (c) {
        withCoords.push({ order: o, coords: c });
      } else {
        withoutCoords.push(o);
      }
    }

    // 1. Construcción inicial por Vecino Más Cercano (Manhattan)
    let route: { order: Order; coords: { lat: number; lng: number } }[] = [];
    let currentPos = BASE_COORDS;
    const remaining = [...withCoords];

    while (remaining.length > 0) {
      let bestIdx = 0;
      let bestDist = manhattanKm(currentPos, remaining[0].coords);

      for (let i = 1; i < remaining.length; i++) {
        const d = manhattanKm(currentPos, remaining[i].coords);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }

      const [picked] = remaining.splice(bestIdx, 1);
      route.push(picked);
      currentPos = picked.coords;
    }

    // 2. Mejora 2-opt sobre el circuito cerrado (incluyendo regreso a BASE_COORDS)
    if (route.length >= 3) {
      let improved = true;
      let bestKm = calcClosedLoopKm(route);

      while (improved) {
        improved = false;
        for (let i = 0; i < route.length - 1; i++) {
          for (let j = i + 1; j < route.length; j++) {
            const candidate = [
              ...route.slice(0, i),
              ...route.slice(i, j + 1).reverse(),
              ...route.slice(j + 1)
            ];
            const candidateKm = calcClosedLoopKm(candidate);
            if (candidateKm + 0.001 < bestKm) {
              route = candidate;
              bestKm = candidateKm;
              improved = true;
            }
          }
        }
      }
    }

    return [...route.map(r => r.order), ...withoutCoords];
  }

  function openOptimalRoute() {
    const routeStops = orderedPendingOrders
      .map(o => ({ order: o, coords: getClientCoords(o) }))
      .filter((item): item is { order: Order; coords: { lat: number; lng: number } } => item.coords !== null)
      .slice(0, 9);

    if (routeStops.length === 0) return;

    const baseStr = `${BASE_COORDS.lat},${BASE_COORDS.lng}`;
    const waypointsStr = routeStops.map(s => `${s.coords.lat},${s.coords.lng}`).join('|');

    const url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(baseStr)}&destination=${encodeURIComponent(baseStr)}&waypoints=${encodeURIComponent(waypointsStr)}&travelmode=driving`;

    window.open(url, '_blank', 'noopener,noreferrer');
  }

  // Paso 1: Abrir modal de Doble Check sugiriendo los envases
  function openDeliverModal(order: Order) {
    orderToDeliver = order;
    emptyReturned = order.garafones; // Sugiere por defecto los buenos entregados
    brokenReturned = 0; // Por defecto 0 rotos
    showDeliverModal = true;
  }

  // Paso 2: Confirmar entrega con control inteligente de buenos, rotos, frecuencia y contador de ventas
  async function confirmDelivery(e: Event) {
    e.preventDefault();
    if (!orderToDeliver) return;

    try {
      const todayStr = new Date().toISOString().split('T')[0];

      // 1. Eliminar pedido de orders para no acumular registros entregados
      await deleteDoc(doc(db, 'orders', orderToDeliver.id));

      // 2. Actualizar contador único de ventas (semana, mes y año)
      await updateSalesCounter(Number(orderToDeliver.garafones) || 0);

      // 3. Actualizar cliente, historial (últimas 5), frecuencia, envases prestados y envases rotos
      const clientRef = doc(db, 'clients', orderToDeliver.clientId);
      const client = clients.find(c => c.id === orderToDeliver.clientId);
      
      if (client) {
        let currentHistory = client.history || [];
        currentHistory = [todayStr, ...currentHistory].slice(0, 5);

        // Recálculo automático de frecuencia
        let newFrecuencia = client.frecuenciaDias || 4;
        if (currentHistory.length >= 2) {
          let totalDaysDiff = 0;
          for (let i = 0; i < currentHistory.length - 1; i++) {
            const dateRecent = new Date(currentHistory[i] + 'T00:00:00');
            const dateOlder = new Date(currentHistory[i + 1] + 'T00:00:00');
            const diffTime = Math.abs(dateRecent.getTime() - dateOlder.getTime());
            const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
            totalDaysDiff += diffDays;
          }
          const avgDays = Math.round(totalDaysDiff / (currentHistory.length - 1));
          if (avgDays > 0) newFrecuencia = avgDays;
        }

        // Recálculo automático de garrafones habituales por promedio (últimas 5 visitas)
        let currentGarafonesHistory = client.garrafonesHistory || [];
        currentGarafonesHistory = [Number(orderToDeliver.garafones), ...currentGarafonesHistory].slice(0, 5);
        const totalGarafonesSum = currentGarafonesHistory.reduce((acc, qty) => acc + qty, 0);
        const avgGarafones = Math.round(totalGarafonesSum / currentGarafonesHistory.length);
        const newDefaultGarafones = avgGarafones > 0 ? avgGarafones : (client.defaultGarafones || 2);

        // Control de Envases: 
        // Entregados llenos: orderToDeliver.garafones
        // Buenos devueltos: Number(emptyReturned)
        // Rotos devueltos: Number(brokenReturned)
        const totalDevueltosEfectivos = Number(emptyReturned) + Number(brokenReturned);
        const currentPrestados = client.prestados || 0;
        const currentRotos = client.rotos || 0;

        // Si devolvió menos de lo que se llevó en total (buenos + rotos), la diferencia se va a prestados/adeudo
        const diferenciaEnvases = orderToDeliver.garafones - totalDevueltosEfectivos;
        const nuevosPrestados = Math.max(0, currentPrestados + diferenciaEnvases);
        const nuevosRotos = currentRotos + Number(brokenReturned);

        await updateDoc(clientRef, {
          lastDelivery: todayStr,
          history: currentHistory,
          frecuenciaDias: newFrecuencia,
          defaultGarafones: newDefaultGarafones,
          garrafonesHistory: currentGarafonesHistory,
          prestados: nuevosPrestados,
          rotos: nuevosRotos // Acumula el garrafón roto detectado en la entrega
        });
      }

      showDeliverModal = false;
      orderToDeliver = null;
      await fetchData();
    } catch (error) {
      console.error('Error al confirmar entrega:', error);
      alert('Hubo un error al actualizar la entrega.');
    }
  }

  let pendingOrders = $derived(orders.filter(o => o.status === 'pendiente'));
  let orderedPendingOrders = $derived(getOptimalRouteOrders(pendingOrders));
  let stopsWithCoordsCount = $derived(
    orderedPendingOrders.filter(o => getClientCoords(o) !== null).length
  );

  let routeStats = $derived.by(() => {
    const stops = orderedPendingOrders
      .map(o => ({ order: o, coords: getClientCoords(o) }))
      .filter((item): item is { order: Order; coords: { lat: number; lng: number } } => item.coords !== null);

    if (stops.length === 0) {
      return { km: 0, minutes: 0 };
    }

    const km = calcClosedLoopKm(stops);
    // Velocidad urbana estimada ~22 km/h + 3 min por parada de entrega
    const drivingMinutes = (km / 22) * 60;
    const stopMinutes = stops.length * 3;
    const minutes = Math.max(1, Math.round(drivingMinutes + stopMinutes));

    return {
      km: Number(km.toFixed(1)),
      minutes
    };
  });

  let loadSummary = $derived.by(() => {
    let total = 0;
    let bonitos = 0;
    let feos = 0;

    for (const order of orderedPendingOrders) {
      const qty = Number(order.garafones) || 0;
      const client = clients.find(c => c.id === order.clientId);
      const isFeo = (client?.rotos || 0) > 2;

      total += qty;
      if (isFeo) {
        feos += qty;
      } else {
        bonitos += qty;
      }
    }

    return { total, bonitos, feos };
  });
</script>

<div class="space-y-6">
  <!-- Cabecera de la Ruta -->
  <div class="flex flex-col sm:flex-row justify-between items-center text-center sm:text-left gap-4 bg-slate-800/60 p-4 rounded-xl border border-slate-700">
    <div>
      <h2 class="text-xl font-bold text-cyan-300">🚚 Ruta de Entregas del Día</h2>
      <p class="text-xs text-slate-400">Tus pendientes en la calle. Al confirmar la entrega, registra envases buenos, rotos y frecuencia.</p>
    </div>
    <button 
      onclick={() => showNewOrderModal = true}
      class="w-full sm:w-auto bg-cyan-500 hover:bg-cyan-600 text-slate-950 font-bold px-4 py-2.5 rounded-lg text-sm transition-colors shadow-lg flex items-center justify-center gap-2 cursor-pointer"
    >
      ➕ Agregar Pedido Rápido
    </button>
  </div>

  <!-- Barra Centrada Arriba de los Pedidos: Ruta Óptima, Resumen y Carga del Carro -->
  {#if !loading && orderedPendingOrders.length > 0}
    <div class="bg-slate-800/80 border border-emerald-500/30 rounded-xl p-4 flex flex-col items-center justify-center gap-3 shadow-lg text-center">
      {#if stopsWithCoordsCount > 0}
        <button
          type="button"
          onclick={openOptimalRoute}
          class="bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-slate-950 font-black px-6 py-2.5 rounded-xl text-sm transition-all shadow-lg shadow-emerald-950/60 flex items-center justify-center gap-2 cursor-pointer"
        >
          🌿🗺️ Ruta Óptima + Regreso ({Math.min(stopsWithCoordsCount, 9)})
        </button>
      {/if}

      <div class="flex flex-wrap items-center justify-center gap-2 text-xs">
        <span class="bg-slate-900 border border-slate-700 px-3 py-1.5 rounded-lg text-slate-200 font-bold">
          🛒 Subir al carro: <strong class="text-cyan-300 text-sm">{loadSummary.total}</strong> garrafones
        </span>
        <span class="bg-emerald-950/70 border border-emerald-700/60 px-3 py-1.5 rounded-lg text-emerald-300 font-semibold">
          ✨ Bonitos: <strong>{loadSummary.bonitos}</strong>
        </span>
        <span class="bg-amber-950/70 border border-amber-700/60 px-3 py-1.5 rounded-lg text-amber-300 font-semibold">
          ⚠️ Feos: <strong>{loadSummary.feos}</strong>
        </span>
        {#if stopsWithCoordsCount > 0}
          <span class="bg-slate-900 border border-emerald-800/60 px-3 py-1.5 rounded-lg text-emerald-300 font-semibold">
            📏 ~{routeStats.km} km (ida y vuelta)
          </span>
          <span class="bg-slate-900 border border-cyan-800/60 px-3 py-1.5 rounded-lg text-cyan-300 font-semibold">
            ⏱️ ~{routeStats.minutes} min est.
          </span>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Lista de Tareas de Reparto -->
  {#if loading}
    <div class="text-center py-12 text-slate-400 animate-pulse">Cargando ruta de entrega...</div>
  {:else if orderedPendingOrders.length === 0}
    <div class="text-center py-16 bg-slate-800/30 rounded-2xl border border-slate-800 space-y-2">
      <div class="text-4xl">🎉</div>
      <p class="text-slate-200 font-bold text-base">¡No hay pedidos pendientes en la ruta!</p>
      <p class="text-xs text-slate-400">Todos los garrafones del día han sido entregados con éxito.</p>
    </div>
  {:else}
    <div class="grid grid-cols-1 gap-4">
      {#each orderedPendingOrders as order}
        {@const phone = getOrderPhone(order)}
        <div class="bg-slate-800/90 border-2 border-cyan-500/40 rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shadow-xl">
          <div class="space-y-1.5 flex-grow">
            <div class="flex items-center gap-3">
              <h3 class="font-black text-lg text-slate-100">{order.clientName}</h3>
              <span class="text-xs bg-cyan-950 px-3 py-1 rounded-full border border-cyan-700 text-cyan-300 font-bold">
                💧 {order.garafones} Garrafón(es)
              </span>
            </div>
            
            <p class="text-xs text-slate-300 flex items-center gap-1">
              📍 <strong class="text-slate-400">Dirección:</strong> {order.address}
            </p>

            <div class="flex flex-wrap items-center gap-2 mt-1">
              {#if phone}
                <a 
                  href="tel:{phone.replace(/\s+/g, '')}" 
                  class="inline-flex items-center gap-1.5 text-xs bg-slate-900 hover:bg-slate-950 text-emerald-400 px-3 py-1.5 rounded-lg border border-slate-700 font-medium transition-colors"
                >
                  📞 Llamar: {phone}
                </a>
              {/if}

              {#if order.mapLink}
                <a 
                  href={order.mapLink} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  class="inline-flex items-center gap-1.5 text-xs bg-slate-900 hover:bg-slate-950 text-cyan-400 px-3 py-1.5 rounded-lg border border-slate-700 font-medium transition-colors"
                >
                  🗺️ Abrir ruta exacta en Google Maps
                </a>
              {/if}
            </div>
          </div>

          <!-- Botón de acción principal con Doble Check -->
          <div class="w-full sm:w-auto flex flex-col gap-2">
            <button 
              onclick={() => openDeliverModal(order)}
              class="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-500 text-white font-black px-6 py-3 rounded-xl transition-all shadow-lg text-sm flex items-center justify-center gap-2 cursor-pointer active:scale-95"
            >
              ✅ Ya Entregué
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Modal de Doble Check: Buenos y Rotos -->
  {#if showDeliverModal && orderToDeliver}
    <div class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex justify-center items-center p-4 z-50">
      <div class="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
        <div class="flex justify-between items-center border-b border-slate-800 pb-3">
          <h3 class="text-lg font-bold text-cyan-300">Confirmar Entrega: {orderToDeliver.clientName}</h3>
          <button onclick={() => showDeliverModal = false} class="text-slate-400 hover:text-white font-bold text-lg cursor-pointer">✕</button>
        </div>

        <div class="bg-slate-950/70 p-3 rounded-xl border border-slate-800 text-xs space-y-1 text-slate-300">
          <p>📦 Garrafones entregados (llenos): <strong class="text-cyan-300 text-sm">{orderToDeliver.garafones}</strong></p>
          <p class="text-slate-400">Verifica el estado de los envases que te devolvió el cliente para actualizar su cuenta.</p>
        </div>

        <form onsubmit={confirmDelivery} class="space-y-4 text-sm">
          <div>
            <label class="block text-xs text-slate-400 mb-1">Envases vacíos en <strong>buen estado</strong> devueltos</label>
            <input 
              type="number" 
              min="0" 
              bind:value={emptyReturned} 
              required 
              class="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100 font-bold focus:border-cyan-400 focus:outline-none" 
            />
            <span class="text-[11px] text-slate-500 mt-0.5 block">Sugerido por defecto igual a los entregados.</span>
          </div>

          <div>
            <label class="block text-xs text-slate-400 mb-1">Envases devueltos que venían <strong>rotos / dañados</strong></label>
            <input 
              type="number" 
              min="0" 
              bind:value={brokenReturned} 
              required 
              class="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-amber-300 font-bold focus:border-amber-400 focus:outline-none" 
            />
            <span class="text-[11px] text-slate-500 mt-0.5 block">⚠️ Si alguno vino roto, ponlo aquí para registrarlo en su historial de rotos.</span>
          </div>

          <div class="flex justify-end gap-3 pt-4 border-t border-slate-800">
            <button type="button" onclick={() => showDeliverModal = false} class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-medium cursor-pointer">Cancelar</button>
            <button type="submit" class="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg shadow-md cursor-pointer">Confirmar y Guardar</button>
          </div>
        </form>
      </div>
    </div>
  {/if}

  <!-- Modal para Agregar Pedido Rápido -->
  {#if showNewOrderModal}
    <div class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex justify-center items-center p-4 z-50">
      <div class="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
        <div class="flex justify-between items-center border-b border-slate-800 pb-3">
          <h3 class="text-lg font-bold text-cyan-300">Registrar Pedido para Hoy</h3>
          <button onclick={() => showNewOrderModal = false} class="text-slate-400 hover:text-white font-bold text-lg cursor-pointer">✕</button>
        </div>

        <form onsubmit={handleCreateOrder} class="space-y-4 text-sm">
          <div>
            <label class="block text-xs text-slate-400 mb-1">Seleccionar Cliente</label>
            <select bind:value={selectedClientId} required class="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100 focus:border-cyan-400 focus:outline-none">
              <option value="" disabled>-- Elige un cliente --</option>
              {#each clients as client}
                <option value={client.id}>{client.name} ({client.address || 'Sin dirección'})</option>
              {/each}
            </select>
          </div>

          <div>
            <label class="block text-xs text-slate-400 mb-1">Cantidad de Garrafones para este Pedido</label>
            <input type="number" min="1" bind:value={customGarafones} required class="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100 focus:border-cyan-400 focus:outline-none" />
          </div>

          <div class="flex justify-end gap-3 pt-4 border-t border-slate-800">
            <button type="button" onclick={() => showNewOrderModal = false} class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-medium cursor-pointer">Cancelar</button>
            <button type="submit" class="px-5 py-2 bg-cyan-500 hover:bg-cyan-600 text-slate-950 font-bold rounded-lg shadow-md cursor-pointer">Añadir a la Ruta</button>
          </div>
        </form>
      </div>
    </div>
  {/if}
</div>