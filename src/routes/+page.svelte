<script lang="ts">
  import { onMount } from 'svelte';
  import { db } from '$lib/firebase';
  import {
    collection,
    getDocs,
    getDoc,
    setDoc,
    doc,
    addDoc,
    serverTimestamp
  } from 'firebase/firestore';

  interface Client {
    id: string;
    name: string;
    phone: string;
    address: string;
    mapLink: string;
    lat?: number | null;
    lng?: number | null;
    defaultGarafones: number;
    prestados: number;
    rotos: number;
    frecuenciaDias: number;
    lastDelivery: string; // formato 'YYYY-MM-DD'
    history?: string[];
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

  let clients = $state<Client[]>([]);
  let orders = $state<Order[]>([]);
  let loading = $state(true);
  let showModal = $state(false);
  let savingClient = $state(false);

  // Estados para levantar pedido desde Mostrador o Sugeridos
  let showNewOrderModal = $state(false);
  let selectedOrderClientId = $state('');
  let customOrderGarafones = $state(2);
  let creatingOrder = $state(false);

  let newClient = $state({
    name: '',
    phone: '',
    address: '',
    mapLink: '',
    coordsText: '',
    defaultGarafones: 2,
    prestados: 0,
    rotos: 0,
    frecuenciaDias: 4,
    lastDelivery: ''
  });

  function getEffectiveLastDelivery(client: Client): string {
    if (client.lastDelivery) return client.lastDelivery;
    if (Array.isArray(client.history) && client.history.length > 0) {
      return client.history[0] || '';
    }
    return '';
  }

  function getEffectiveFrequency(client: Client): number {
    const freq = Number(client.frecuenciaDias);
    return Number.isFinite(freq) && freq > 0 ? freq : 4;
  }

  function extractCoords(input: string): { lat: number; lng: number } | null {
    if (!input) return null;
    // Busca patrones como @19.5081,-99.0142 o 19.5081, -99.0142 o !3d19.5081!4d-99.0142
    const d3d4Match = input.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (d3d4Match) {
      return { lat: parseFloat(d3d4Match[1]), lng: parseFloat(d3d4Match[2]) };
    }
    const pairMatch = input.match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
    if (pairMatch) {
      return { lat: parseFloat(pairMatch[1]), lng: parseFloat(pairMatch[2]) };
    }
    return null;
  }

  function handleMapLinkInput() {
    const parsed = extractCoords(newClient.mapLink);
    if (parsed) {
      newClient.coordsText = `${parsed.lat}, ${parsed.lng}`;
    }
  }

  onMount(async () => {
    await fetchData();
  });

  async function fetchData() {
    try {
      loading = true;
      const [querySnapshot, orderSnap] = await Promise.all([
        getDocs(collection(db, 'clients')),
        getDocs(collection(db, 'orders'))
      ]);
      clients = querySnapshot.docs.map(d => ({
        id: d.id,
        ...d.data()
      })) as Client[];
      orders = orderSnap.docs.map(d => ({
        id: d.id,
        ...d.data()
      })) as Order[];
    } catch (error) {
      console.error('Error al cargar clientes:', error);
    } finally {
      loading = false;
    }
  }

  async function handleAddClient(e: Event) {
    e.preventDefault();
    if (savingClient) return;

    savingClient = true;
    try {
      const parsedCoords = extractCoords(newClient.coordsText) || extractCoords(newClient.mapLink);
      const { coordsText, ...clientData } = newClient;

      await addDoc(collection(db, 'clients'), {
        ...clientData,
        name: clientData.name.trim(),
        phone: clientData.phone.trim(),
        address: clientData.address.trim(),
        mapLink: clientData.mapLink.trim(),
        defaultGarafones: Number(clientData.defaultGarafones) || 2,
        prestados: Number(clientData.prestados) || 0,
        rotos: Number(clientData.rotos) || 0,
        frecuenciaDias: getEffectiveFrequency(clientData as Client),
        lat: parsedCoords ? parsedCoords.lat : null,
        lng: parsedCoords ? parsedCoords.lng : null,
        createdAt: serverTimestamp()
      });

      newClient = {
        name: '',
        phone: '',
        address: '',
        mapLink: '',
        coordsText: '',
        defaultGarafones: 2,
        prestados: 0,
        rotos: 0,
        frecuenciaDias: 4,
        lastDelivery: ''
      };
      showModal = false;
      await fetchData();
    } catch (error: any) {
      console.error('Error al guardar cliente:', error);
      alert(`No se pudo guardar el cliente (${error?.code || error?.message || 'error de red'}). Revisa tu conexión e intenta de nuevo.`);
    } finally {
      savingClient = false;
    }
  }

  function openQuickOrderModal(client?: Client) {
    if (creatingOrder) return;
    if (client) {
      selectedOrderClientId = client.id;
      customOrderGarafones = Number(client.defaultGarafones) || 2;
    } else {
      selectedOrderClientId = '';
      customOrderGarafones = 2;
    }
    showNewOrderModal = true;
  }

  function handleSelectOrderClientChange() {
    const client = clients.find(c => c.id === selectedOrderClientId);
    if (!client) return;
    customOrderGarafones = Number(client.defaultGarafones) || 2;
  }

  async function handleCreateOrder(e: Event) {
    e.preventDefault();
    if (!selectedOrderClientId || creatingOrder) return;

    const client = clients.find(c => c.id === selectedOrderClientId);
    if (!client) return;

    creatingOrder = true;
    try {
      const orderRef = doc(db, 'orders', client.id);
      const existingSnap = await getDoc(orderRef);

      if (existingSnap.exists() && existingSnap.data()?.status === 'pendiente') {
        const prevQty = Number(existingSnap.data()?.garafones) || 0;
        const newQty = Number(customOrderGarafones) || 1;
        const ok = confirm(
          `⚠️ ${client.name} ya tiene un pedido pendiente en la ruta por ${prevQty} garrafón(es) (lo acaba de registrar alguien del equipo).\n\nPresiona "Aceptar" para actualizarlo a ${newQty} garrafón(es) o "Cancelar" para dejar el que ya estaba.`
        );
        if (!ok) {
          showNewOrderModal = false;
          selectedOrderClientId = '';
          customOrderGarafones = 2;
          await fetchData();
          return;
        }
      }

      await setDoc(orderRef, {
        clientId: client.id,
        clientName: client.name,
        clientPhone: client.phone || '',
        address: client.address || 'Sin dirección',
        mapLink: client.mapLink || '',
        garafones: Number(customOrderGarafones) || 1,
        status: 'pendiente',
        createdAt: serverTimestamp()
      });

      showNewOrderModal = false;
      selectedOrderClientId = '';
      customOrderGarafones = 2;
      await fetchData();
    } catch (error: any) {
      console.error('Error al crear pedido:', error);
      alert(
        `No se pudo registrar el pedido (${error?.code || error?.message || 'error de red'}). Revisa tu conexión e intenta de nuevo.`
      );
    } finally {
      creatingOrder = false;
    }
  }

  function getRemainingDays(client: Client): number | null {
    const lastDelivery = getEffectiveLastDelivery(client);
    if (!lastDelivery) return null;

    const lastDate = new Date(lastDelivery + 'T00:00:00');
    if (Number.isNaN(lastDate.getTime())) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const diffTime = today.getTime() - lastDate.getTime();
    const passedDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const freq = getEffectiveFrequency(client);
    return freq - passedDays;
  }

  // Calcular días transcurridos y estado de días restantes
  function getDeliveryStatus(client: Client) {
    const remainingDays = getRemainingDays(client);
    if (remainingDays === null) {
      return { text: '✨ Nuevo / Sin entregas', class: 'bg-cyan-950/60 text-cyan-300 border-cyan-800' };
    }

    if (remainingDays > 0) {
      return { text: `⏳ Quedan ${remainingDays} día(s)`, class: 'bg-slate-900 text-slate-300 border-slate-700' };
    } else if (remainingDays === 0) {
      return { text: '⚠️ ¡Toca agua hoy!', class: 'bg-amber-950/60 text-amber-300 border-amber-700' };
    } else {
      const overdue = Math.abs(remainingDays);
      return { text: `🚨 Vencido hace ${overdue} día(s)`, class: 'bg-rose-950/60 text-rose-300 border-rose-800 font-bold' };
    }
  }

  function needsWaterToday(client: Client): boolean {
    const remainingDays = getRemainingDays(client);
    if (remainingDays === null) return true;
    return remainingDays <= 0;
  }

  function formatWhatsAppPhone(rawPhone: string): string {
    const digits = rawPhone.replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('52')) {
      return digits;
    }
    if (digits.length === 13 && digits.startsWith('521')) {
      return `52${digits.slice(3)}`;
    }
    return `52${digits}`;
  }

  function openWhatsApp(client: Client) {
    const phoneWithCode = formatWhatsAppPhone(client.phone || '');
    const hour = new Date().getHours();
    let saludo = 'buenas noches';
    if (hour >= 5 && hour < 12) {
      saludo = 'buenos días';
    } else if (hour >= 12 && hour < 19) {
      saludo = 'buenas tardes';
    }

    const rawText = `Hola, ${saludo} ☺️. Solo quería preguntarle si va a necesitar agua el día de hoy? 💧`;
    const message = encodeURIComponent(rawText);
    window.open(`https://api.whatsapp.com/send?phone=${phoneWithCode}&text=${message}`, '_blank', 'noopener,noreferrer');
  }

  let pendingClientIds = $derived(
    new Set(orders.filter(o => o.status === 'pendiente').map(o => o.clientId))
  );

  let availableClientsForOrder = $derived(
    clients.filter(c => !pendingClientIds.has(c.id))
  );

  let suggestedClients = $derived(
    clients
      .filter(c => needsWaterToday(c))
      .sort((a, b) => {
        const remA = getRemainingDays(a);
        const remB = getRemainingDays(b);
        // Los nuevos (null) van después de los vencidos/hoy; entre fechas, los más atrasados primero
        const scoreA = remA === null ? 1 : remA;
        const scoreB = remB === null ? 1 : remB;
        return scoreA - scoreB;
      })
  );
</script>

<div class="space-y-6">
  <!-- Cabecera del Módulo -->
  <div class="flex flex-col sm:flex-row justify-between items-center text-center sm:text-left gap-4 bg-slate-800/60 p-4 rounded-xl border border-slate-700">
    <div>
      <h2 class="text-xl font-bold text-cyan-300">Control de Clientes & Mostrador</h2>
      <p class="text-xs text-slate-400">Gestión de perfiles, envases y alertas de frecuencia de compra.</p>
    </div>
    <div class="w-full sm:w-auto flex flex-col sm:flex-row gap-2">
      <button
        type="button"
        onclick={() => openQuickOrderModal()}
        disabled={savingClient || creatingOrder}
        class="w-full sm:w-auto bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold px-4 py-2.5 rounded-lg text-sm transition-colors shadow-lg flex items-center justify-center gap-2 cursor-pointer"
      >
        🚚 Agregar Pedido
      </button>
      <button 
        type="button"
        onclick={() => showModal = true}
        disabled={savingClient || creatingOrder}
        class="w-full sm:w-auto bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 text-slate-950 font-bold px-4 py-2.5 rounded-lg text-sm transition-colors shadow-lg flex items-center justify-center gap-2 cursor-pointer"
      >
        ➕ Nuevo Cliente
      </button>
    </div>
  </div>

  <!-- Sección de Alertas Inteligentes -->
  <div class="bg-cyan-950/30 border border-cyan-800/50 rounded-xl p-4 space-y-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h3 class="font-bold text-cyan-300 text-sm flex items-center gap-2">
        🔔 Clientes Sugeridos a Contactar Hoy ({suggestedClients.length})
      </h3>
      <span class="text-[11px] text-cyan-400/80 bg-cyan-900/40 px-2.5 py-1 rounded-md border border-cyan-700/40">
        Basado en su frecuencia de compra
      </span>
    </div>

    {#if loading}
      <p class="text-xs text-slate-400 animate-pulse">Calculando frecuencias...</p>
    {:else if suggestedClients.length === 0}
      <p class="text-xs text-slate-400">No hay clientes pendientes de contacto por frecuencia el día de hoy. ¡Todo en orden!</p>
    {:else}
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        {#each suggestedClients as client}
          {@const lastDelivery = getEffectiveLastDelivery(client)}
          {@const status = getDeliveryStatus(client)}
          {@const alreadyInRoute = pendingClientIds.has(client.id)}
          <div class="bg-slate-900/90 border border-cyan-900/60 rounded-lg p-3 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 shadow-sm min-w-0">
            <div class="min-w-0 space-y-1.5">
              <h4 class="font-bold text-slate-100 text-sm truncate">{client.name}</h4>
              <p class="text-[11px] text-slate-400">Última entrega: {lastDelivery || 'Ninguna'} ({Number(client.defaultGarafones) || 2} garrafones)</p>
              <span class="inline-block text-[11px] px-2.5 py-0.5 rounded-md border {status.class}">
                {status.text}
              </span>
            </div>

            <div class="w-full sm:w-auto flex items-center justify-end gap-2 shrink-0">
              {#if alreadyInRoute}
                <span class="text-[11px] bg-cyan-950/80 text-cyan-300 border border-cyan-700/60 px-2.5 py-1.5 rounded-lg font-bold">
                  ✅ En ruta
                </span>
              {:else}
                <button
                  type="button"
                  onclick={() => openQuickOrderModal(client)}
                  disabled={creatingOrder}
                  class="bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 text-xs font-bold px-3 py-2 rounded-lg transition-colors flex items-center gap-1 shadow cursor-pointer"
                >
                  🚚 Pedido
                </button>
              {/if}

              {#if client.phone}
                <button 
                  type="button"
                  onclick={() => openWhatsApp(client)}
                  class="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5 shadow cursor-pointer"
                >
                  💬 Contactar
                </button>
              {:else}
                <span class="text-[10px] text-slate-500 italic">Sin teléfono</span>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Listado General de Clientes -->
  <div class="space-y-3">
    <h3 class="font-bold text-slate-200 text-sm">Directorio General de Clientes ({clients.length})</h3>
    
    {#if loading}
      <div class="text-center py-12 text-slate-400 animate-pulse">Cargando base de datos de clientes...</div>
    {:else if clients.length === 0}
      <div class="text-center py-12 bg-slate-800/30 rounded-xl border border-slate-800">
        <p class="text-slate-400 text-sm">No hay clientes registrados todavía.</p>
      </div>
    {:else}
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        {#each clients as client}
          {@const status = getDeliveryStatus(client)}
          {@const lastDelivery = getEffectiveLastDelivery(client)}
          {@const freq = getEffectiveFrequency(client)}
          <div class="bg-slate-800/80 border border-slate-700/80 rounded-xl p-4 space-y-3 shadow-md hover:border-cyan-500/50 transition-all min-w-0">
            <div class="flex justify-between items-start gap-2">
              <div class="min-w-0">
                <h3 class="font-bold text-base text-slate-100 break-words">{client.name}</h3>
                <p class="text-xs text-cyan-400">📞 {client.phone || 'Sin teléfono'}</p>
              </div>
              <div class="text-right flex flex-col items-end gap-1 shrink-0">
                <span class="text-xs bg-slate-900 px-2.5 py-1 rounded-md border border-slate-700 text-slate-300 font-semibold">
                  {Number(client.defaultGarafones) || 2} Garrafón(es)
                </span>
              </div>
            </div>

            <!-- Indicador Dinámico de Días Restantes -->
            <div class="flex items-center justify-between gap-2 text-xs px-3 py-2 rounded-lg border {status.class}">
              <span>Estado de consumo:</span>
              <strong class="font-bold text-right">{status.text}</strong>
            </div>

            <div class="text-xs text-slate-300 space-y-1 bg-slate-900/50 p-2.5 rounded-lg border border-slate-800 break-words">
              <p><strong class="text-slate-400">Dirección:</strong> {client.address || 'No especificada'}</p>
              {#if client.mapLink}
                <p>
                  <a href={client.mapLink} target="_blank" rel="noopener noreferrer" class="text-cyan-400 hover:underline inline-flex items-center gap-1 font-medium mt-1">
                    🗺️ Abrir ubicación en Google Maps
                  </a>
                </p>
              {/if}
            </div>

            <!-- Control de Envases y Estado -->
            <div class="grid grid-cols-2 gap-2 text-xs pt-1">
              <div class="bg-slate-900/80 p-2 rounded border border-slate-800 text-center">
                <span class="text-slate-400 block">Envases Prestados</span>
                <strong class="text-cyan-300 text-sm">{Number(client.prestados) || 0}</strong>
              </div>
              <div class="bg-slate-900/80 p-2 rounded border border-slate-800 text-center">
                <span class="text-slate-400 block">Envases Rotos</span>
                <strong class="text-amber-400 text-sm">{Number(client.rotos) || 0}</strong>
                <span class="text-[10px] block text-slate-500">
                  {(Number(client.rotos) || 0) > 2 ? '⚠️ Asignar garrafón desgastado' : '✨ Garrafón en buen estado'}
                </span>
              </div>
            </div>

            <div class="text-[11px] text-slate-400 pt-1 flex justify-between items-center gap-2 border-t border-slate-700/50">
              <span>Última entrega: <strong class="text-slate-200">{lastDelivery || 'Ninguna'}</strong></span>
              <span>Frecuencia: <strong class="text-slate-200">{freq} días</strong></span>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Modal para Levantar Pedido Rápido a Ruta -->
  {#if showNewOrderModal}
    <div class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex justify-center items-center p-4 z-50">
      <div class="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
        <div class="flex justify-between items-center border-b border-slate-800 pb-3">
          <h3 class="text-lg font-bold text-cyan-300">🚚 Levantar Pedido para la Ruta</h3>
          <button
            type="button"
            disabled={creatingOrder}
            onclick={() => showNewOrderModal = false}
            class="text-slate-400 hover:text-white disabled:opacity-50 font-bold text-lg cursor-pointer"
          >✕</button>
        </div>

        <form onsubmit={handleCreateOrder} class="space-y-4 text-sm">
          <div>
            <label class="block text-xs text-slate-400 mb-1">Seleccionar Cliente (sin pedido activo)</label>
            <select
              bind:value={selectedOrderClientId}
              onchange={handleSelectOrderClientChange}
              required
              disabled={creatingOrder || availableClientsForOrder.length === 0}
              class="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100 focus:border-cyan-400 focus:outline-none"
            >
              <option value="" disabled>
                {availableClientsForOrder.length === 0
                  ? '-- Todos los clientes ya tienen pedido en ruta --'
                  : '-- Elige un cliente --'}
              </option>
              {#each availableClientsForOrder as client}
                <option value={client.id}>
                  {client.name} ({client.address || 'Sin dirección'})
                </option>
              {/each}
            </select>
          </div>

          <div>
            <label class="block text-xs text-slate-400 mb-1">Cantidad de Garrafones para este Pedido</label>
            <input
              type="number"
              min="1"
              bind:value={customOrderGarafones}
              required
              disabled={creatingOrder || availableClientsForOrder.length === 0}
              class="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100 focus:border-cyan-400 focus:outline-none"
            />
          </div>

          <div class="flex justify-end gap-3 pt-4 border-t border-slate-800">
            <button
              type="button"
              disabled={creatingOrder}
              onclick={() => showNewOrderModal = false}
              class="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 rounded-lg font-medium cursor-pointer"
            >Cancelar</button>
            <button
              type="submit"
              disabled={creatingOrder || availableClientsForOrder.length === 0}
              class="px-5 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold rounded-lg shadow-md cursor-pointer"
            >{creatingOrder ? 'Añadiendo...' : 'Mandar a la Ruta'}</button>
          </div>
        </form>
      </div>
    </div>
  {/if}

  <!-- Modal para Nuevo Cliente -->
  {#if showModal}
    <div class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex justify-center items-center p-4 z-50">
      <div class="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto min-w-0">
        <div class="flex justify-between items-center border-b border-slate-800 pb-3">
          <h3 class="text-lg font-bold text-cyan-300">Registrar Nuevo Cliente</h3>
          <button
            type="button"
            disabled={savingClient}
            onclick={() => showModal = false}
            class="text-slate-400 hover:text-white disabled:opacity-50 font-bold text-lg cursor-pointer"
          >✕</button>
        </div>

        <form onsubmit={handleAddClient} class="space-y-4 text-sm min-w-0">
          <div class="min-w-0">
            <label class="block text-xs text-slate-400 mb-1">Nombre Completo del Cliente</label>
            <input type="text" bind:value={newClient.name} required disabled={savingClient} placeholder="Ej. Juan Pérez" class="w-full min-w-0 bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100 focus:border-cyan-400 focus:outline-none" />
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0">
            <div class="min-w-0">
              <label class="block text-xs text-slate-400 mb-1">Teléfono / WhatsApp</label>
              <input type="text" bind:value={newClient.phone} disabled={savingClient} placeholder="Ej. 5512345678" class="w-full min-w-0 bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100 focus:border-cyan-400 focus:outline-none" />
            </div>
            <div class="min-w-0">
              <label class="block text-xs text-slate-400 mb-1">Garrafones Habituales</label>
              <input type="number" min="1" bind:value={newClient.defaultGarafones} disabled={savingClient} class="w-full min-w-0 bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100 focus:border-cyan-400 focus:outline-none" />
            </div>
          </div>

          <div class="min-w-0">
            <label class="block text-xs text-slate-400 mb-1">Dirección y Señas Particulares</label>
            <textarea bind:value={newClient.address} rows="2" disabled={savingClient} placeholder="Ej. Calle Morelos #123, zaguán negro" class="w-full min-w-0 bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100 focus:border-cyan-400 focus:outline-none"></textarea>
          </div>

          <div class="min-w-0">
            <label class="block text-xs text-slate-400 mb-1">Link de Google Maps</label>
            <input type="url" bind:value={newClient.mapLink} oninput={handleMapLinkInput} disabled={savingClient} placeholder="https://maps.app.goo.gl/..." class="w-full min-w-0 bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100 focus:border-cyan-400 focus:outline-none" />
          </div>

          <div class="min-w-0">
            <label class="block text-xs text-slate-400 mb-1">Coordenadas (lat, lng) <span class="text-slate-500">— se llenan solas con link largo o pégalas si el link es corto</span></label>
            <input type="text" bind:value={newClient.coordsText} disabled={savingClient} placeholder="Ej. 19.508123, -99.014256" class="w-full min-w-0 bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100 focus:border-cyan-400 focus:outline-none" />
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 min-w-0">
            <div class="min-w-0">
              <label class="block text-xs text-slate-400 mb-1">Frecuencia de Compra (días)</label>
              <input type="number" min="1" bind:value={newClient.frecuenciaDias} disabled={savingClient} class="w-full min-w-0 bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100 focus:border-cyan-400 focus:outline-none" />
            </div>
            <div class="min-w-0">
              <label class="block text-xs text-slate-400 mb-1">Envases Prestados</label>
              <input type="number" min="0" bind:value={newClient.prestados} disabled={savingClient} class="w-full min-w-0 bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100 focus:border-cyan-400 focus:outline-none" />
            </div>
            <div class="min-w-0">
              <label class="block text-xs text-slate-400 mb-1">Envases Rotos</label>
              <input type="number" min="0" bind:value={newClient.rotos} disabled={savingClient} class="w-full min-w-0 bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100 focus:border-cyan-400 focus:outline-none" />
            </div>
          </div>

          <div class="flex justify-end gap-3 pt-4 border-t border-slate-800">
            <button
              type="button"
              disabled={savingClient}
              onclick={() => showModal = false}
              class="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 rounded-lg font-medium cursor-pointer"
            >Cancelar</button>
            <button
              type="submit"
              disabled={savingClient}
              class="px-5 py-2 bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 text-slate-950 font-bold rounded-lg shadow-md cursor-pointer"
            >{savingClient ? 'Guardando...' : 'Guardar Cliente'}</button>
          </div>
        </form>
      </div>
    </div>
  {/if}
</div>