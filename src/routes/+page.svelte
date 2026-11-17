<script lang="ts">
  import { onMount } from 'svelte';
  import { db } from '$lib/firebase';
  import { collection, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';

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
    lastDelivery: string; // formato 'YYYY-MM-DD'
  }

  let clients = $state<Client[]>([]);
  let loading = $state(true);
  let showModal = $state(false);

  let newClient = $state({
    name: '',
    phone: '',
    address: '',
    mapLink: '',
    defaultGarafones: 2,
    prestados: 0,
    rotos: 0,
    frecuenciaDias: 4,
    lastDelivery: ''
  });

  onMount(async () => {
    await fetchClients();
  });

  async function fetchClients() {
    try {
      loading = true;
      const querySnapshot = await getDocs(collection(db, 'clients'));
      clients = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Client[];
    } catch (error) {
      console.error('Error al cargar clientes:', error);
    } finally {
      loading = false;
    }
  }

  async function handleAddClient(e: Event) {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'clients'), {
        ...newClient,
        createdAt: serverTimestamp()
      });
      newClient = {
        name: '',
        phone: '',
        address: '',
        mapLink: '',
        defaultGarafones: 2,
        prestados: 0,
        rotos: 0,
        frecuenciaDias: 4,
        lastDelivery: ''
      };
      showModal = false;
      await fetchClients();
    } catch (error) {
      console.error('Error al guardar cliente:', error);
      alert('Hubo un error al guardar el cliente.');
    }
  }

  // Calcular días transcurridos y estado de días restantes
  function getDeliveryStatus(client: Client) {
    if (!client.lastDelivery) {
      return { text: '✨ Nuevo / Sin entregas', class: 'bg-cyan-950/60 text-cyan-300 border-cyan-800' };
    }

    const lastDate = new Date(client.lastDelivery + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const diffTime = today.getTime() - lastDate.getTime();
    const passedDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const remainingDays = client.frecuenciaDias - passedDays;

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
    if (!client.lastDelivery) return true;
    const lastDate = new Date(client.lastDelivery + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.floor((today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays >= client.frecuenciaDias;
  }

  function getWhatsAppLink(client: Client): string {
    const cleanPhone = client.phone.replace(/\D/g, '');
    const message = encodeURIComponent(`¡Hola ${client.name}! Buen día, notamos que probablemente ya se te esté acabando el agua de tu garrafón. ¿Te mandamos tus ${client.defaultGarafones} de siempre hoy?`);
    return `https://api.whatsapp.com/send?phone=52${cleanPhone}&text=${message}`;
  }

  let suggestedClients = $derived(clients.filter(c => needsWaterToday(c)));
</script>

<div class="space-y-6">
  <!-- Cabecera del Módulo -->
  <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-800/60 p-4 rounded-xl border border-slate-700">
    <div>
      <h2 class="text-xl font-bold text-cyan-300">Control de Clientes & Mostrador</h2>
      <p class="text-xs text-slate-400">Gestión de perfiles, envases y alertas de frecuencia de compra.</p>
    </div>
    <button 
      onclick={() => showModal = true}
      class="bg-cyan-500 hover:bg-cyan-600 text-slate-950 font-bold px-4 py-2 rounded-lg text-sm transition-colors shadow-lg flex items-center gap-2 cursor-pointer"
    >
      ➕ Nuevo Cliente
    </button>
  </div>

  <!-- Sección de Alertas Inteligentes -->
  <div class="bg-cyan-950/30 border border-cyan-800/50 rounded-xl p-4 space-y-3">
    <div class="flex items-center justify-between">
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
          <div class="bg-slate-900/90 border border-cyan-900/60 rounded-lg p-3 flex justify-between items-center gap-2 shadow-sm">
            <div>
              <h4 class="font-bold text-slate-100 text-sm">{client.name}</h4>
              <p class="text-[11px] text-slate-400">Última entrega: {client.lastDelivery || 'Ninguna'} ({client.defaultGarafones} garrafones)</p>
            </div>
            {#if client.phone}
              <a 
                href={getWhatsAppLink(client)} 
                target="_blank" 
                rel="noopener noreferrer"
                class="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5 shadow"
              >
                💬 WhatsApp 1 Clic
              </a>
            {:else}
              <span class="text-[10px] text-slate-500 italic">Sin teléfono</span>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Listado General de Clientes -->
  <div class="space-y-3">
    <h3 class="font-bold text-slate-200 text-sm">Directorio General de Clientes</h3>
    
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
          <div class="bg-slate-800/80 border border-slate-700/80 rounded-xl p-4 space-y-3 shadow-md hover:border-cyan-500/50 transition-all">
            <div class="flex justify-between items-start">
              <div>
                <h3 class="font-bold text-base text-slate-100">{client.name}</h3>
                <p class="text-xs text-cyan-400">📞 {client.phone || 'Sin teléfono'}</p>
              </div>
              <div class="text-right flex flex-col items-end gap-1">
                <span class="text-xs bg-slate-900 px-2.5 py-1 rounded-md border border-slate-700 text-slate-300 font-semibold">
                  {client.defaultGarafones} Garrafón(es)
                </span>
              </div>
            </div>

            <!-- Indicador Dinámico de Días Restantes -->
            <div class="flex items-center justify-between text-xs px-3 py-2 rounded-lg border {status.class}">
              <span>Estado de consumo:</span>
              <strong class="font-bold">{status.text}</strong>
            </div>

            <div class="text-xs text-slate-300 space-y-1 bg-slate-900/50 p-2.5 rounded-lg border border-slate-800">
              <p><strong class="text-slate-400">Dirección:</strong> {client.address || 'No especificada'}</p>
              {#if client.mapLink}
                <p>
                  <a href={client.mapLink} target="_blank" rel="noopener noreferrer" class="text-cyan-400 hover:underline flex items-center gap-1 font-medium mt-1">
                    🗺️ Abrir ubicación en Google Maps
                  </a>
                </p>
              {/if}
            </div>

            <!-- Control de Envases y Estado -->
            <div class="grid grid-cols-2 gap-2 text-xs pt-1">
              <div class="bg-slate-900/80 p-2 rounded border border-slate-800 text-center">
                <span class="text-slate-400 block">Envases Prestados</span>
                <strong class="text-cyan-300 text-sm">{client.prestados || 0}</strong>
              </div>
              <div class="bg-slate-900/80 p-2 rounded border border-slate-800 text-center">
                <span class="text-slate-400 block">Envases Rotos</span>
                <strong class="text-amber-400 text-sm">{client.rotos || 0}</strong>
                <span class="text-[10px] block text-slate-500">
                  {(client.rotos || 0) > 2 ? '⚠️ Asignar garrafón desgastado' : '✨ Garrafón en buen estado'}
                </span>
              </div>
            </div>

            <div class="text-[11px] text-slate-400 pt-1 flex justify-between items-center border-t border-slate-700/50">
              <span>Última entrega: <strong class="text-slate-200">{client.lastDelivery || 'Ninguna'}</strong></span>
              <span>Frecuencia: <strong class="text-slate-200">{client.frecuenciaDias} días</strong></span>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Modal para Nuevo Cliente -->
  {#if showModal}
    <div class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex justify-center items-center p-4 z-50">
      <div class="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div class="flex justify-between items-center border-b border-slate-800 pb-3">
          <h3 class="text-lg font-bold text-cyan-300">Registrar Nuevo Cliente</h3>
          <button onclick={() => showModal = false} class="text-slate-400 hover:text-white font-bold text-lg cursor-pointer">✕</button>
        </div>

        <form onsubmit={handleAddClient} class="space-y-4 text-sm">
          <div>
            <label class="block text-xs text-slate-400 mb-1">Nombre Completo del Cliente</label>
            <input type="text" bind:value={newClient.name} required placeholder="Ej. Juan Pérez" class="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100 focus:border-cyan-400 focus:outline-none" />
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-xs text-slate-400 mb-1">Teléfono / WhatsApp</label>
              <input type="text" bind:value={newClient.phone} placeholder="Ej. 8112345678" class="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100 focus:border-cyan-400 focus:outline-none" />
            </div>
            <div>
              <label class="block text-xs text-slate-400 mb-1">Garrafones Habituales</label>
              <input type="number" min="1" bind:value={newClient.defaultGarafones} class="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100 focus:border-cyan-400 focus:outline-none" />
            </div>
          </div>

          <div>
            <label class="block text-xs text-slate-400 mb-1">Dirección y Señas Particulares</label>
            <textarea bind:value={newClient.address} rows="2" placeholder="Ej. Calle Morelos #123, zaguán negro" class="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100 focus:border-cyan-400 focus:outline-none"></textarea>
          </div>

          <div>
            <label class="block text-xs text-slate-400 mb-1">Link de Google Maps</label>
            <input type="url" bind:value={newClient.mapLink} placeholder="https://maps.app.goo.gl/..." class="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100 focus:border-cyan-400 focus:outline-none" />
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label class="block text-xs text-slate-400 mb-1">Frecuencia de Compra (días)</label>
              <input type="number" min="1" bind:value={newClient.frecuenciaDias} class="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100 focus:border-cyan-400 focus:outline-none" />
            </div>
            <div>
              <label class="block text-xs text-slate-400 mb-1">Envases Prestados</label>
              <input type="number" min="0" bind:value={newClient.prestados} class="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100 focus:border-cyan-400 focus:outline-none" />
            </div>
            <div>
              <label class="block text-xs text-slate-400 math mb-1">Envases Rotos</label>
              <input type="number" min="0" bind:value={newClient.rotos} class="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100 focus:border-cyan-400 focus:outline-none" />
            </div>
          </div>

          <div class="flex justify-end gap-3 pt-4 border-t border-slate-800">
            <button type="button" onclick={() => showModal = false} class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-medium cursor-pointer">Cancelar</button>
            <button type="submit" class="px-5 py-2 bg-cyan-500 hover:bg-cyan-600 text-slate-950 font-bold rounded-lg shadow-md cursor-pointer">Guardar Cliente</button>
          </div>
        </form>
      </div>
    </div>
  {/if}
</div>