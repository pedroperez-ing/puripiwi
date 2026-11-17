<script lang="ts">
  import { onMount } from 'svelte';
  import { db } from '$lib/firebase';
  import { collection, getDocs, doc, updateDoc, addDoc, serverTimestamp } from 'firebase/firestore';

  interface Client {
    id: string;
    name: string;
    phone: string;
    address: string;
    mapLink: string;
    defaultGarafones: number;
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
    address: string;
    mapLink: string;
    garafones: number;
    status: 'pendiente' | 'entregado';
    createdAt: any;
  }

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

  async function handleCreateOrder(e: Event) {
    e.preventDefault();
    if (!selectedClientId) return;

    const client = clients.find(c => c.id === selectedClientId);
    if (!client) return;

    try {
      await addDoc(collection(db, 'orders'), {
        clientId: client.id,
        clientName: client.name,
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

  // Paso 1: Abrir modal de Doble Check sugiriendo los envases
  function openDeliverModal(order: Order) {
    orderToDeliver = order;
    emptyReturned = order.garafones; // Sugiere por defecto los buenos entregados
    brokenReturned = 0; // Por defecto 0 rotos
    showDeliverModal = true;
  }

  // Paso 2: Confirmar entrega con control inteligente de buenos, rotos, frecuencia y ventas
  async function confirmDelivery(e: Event) {
    e.preventDefault();
    if (!orderToDeliver) return;

    try {
      const todayStr = new Date().toISOString().split('T')[0];

      // 1. Marcar pedido como entregado
      await updateDoc(doc(db, 'orders', orderToDeliver.id), {
        status: 'entregado'
      });

      // 2. Actualizar cliente, historial, frecuencia, envases prestados y envases rotos
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

        // Registrar venta para contabilidad
        await addDoc(collection(db, 'sales'), {
          clientId: client.id,
          clientName: client.name,
          garafones: orderToDeliver.garafones,
          date: todayStr,
          timestamp: serverTimestamp()
        });

        await updateDoc(clientRef, {
          lastDelivery: todayStr,
          history: currentHistory,
          frecuenciaDias: newFrecuencia,
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
</script>

<div class="space-y-6">
  <!-- Cabecera de la Ruta -->
  <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-800/60 p-4 rounded-xl border border-slate-700">
    <div>
      <h2 class="text-xl font-bold text-cyan-300">🚚 Ruta de Entregas del Día</h2>
      <p class="text-xs text-slate-400">Tus pendientes en la calle. Al confirmar la entrega, registra envases buenos, rotos y frecuencia.</p>
    </div>
    <button 
      onclick={() => showNewOrderModal = true}
      class="bg-cyan-500 hover:bg-cyan-600 text-slate-950 font-bold px-4 py-2 rounded-lg text-sm transition-colors shadow-lg flex items-center gap-2 cursor-pointer"
    >
      ➕ Agregar Pedido Rápido
    </button>
  </div>

  <!-- Lista de Tareas de Reparto -->
  {#if loading}
    <div class="text-center py-12 text-slate-400 animate-pulse">Cargando ruta de entrega...</div>
  {:else if pendingOrders.length === 0}
    <div class="text-center py-16 bg-slate-800/30 rounded-2xl border border-slate-800 space-y-2">
      <div class="text-4xl">🎉</div>
      <p class="text-slate-200 font-bold text-base">¡No hay pedidos pendientes en la ruta!</p>
      <p class="text-xs text-slate-400">Todos los garrafones del día han sido entregados con éxito.</p>
    </div>
  {:else}
    <div class="grid grid-cols-1 gap-4">
      {#each pendingOrders as order}
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

            {#if order.mapLink}
              <div>
                <a 
                  href={order.mapLink} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  class="inline-flex items-center gap-1.5 text-xs bg-slate-900 hover:bg-slate-950 text-cyan-400 px-3 py-1.5 rounded-lg border border-slate-700 font-medium transition-colors mt-1"
                >
                  🗺️ Abrir ruta exacta en Google Maps
                </a>
              </div>
            {/if}
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