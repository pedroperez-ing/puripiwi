<script lang="ts">
  import './layout.css';
  import favicon from '$lib/assets/favicon.svg';
  import type { LayoutProps } from './$types';

  let { children }: LayoutProps = $props();

  let darkMode = $state(true);

  function toggleTheme() {
    darkMode = !darkMode;
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
</svelte:head>

<div class="min-h-screen bg-slate-900 text-slate-100 dark:bg-slate-900 dark:text-slate-100 transition-colors duration-200 flex flex-col justify-between">
  <!-- Contenido principal -->
  <main class="max-w-4xl mx-auto w-full p-4 flex-grow space-y-4">
    <header class="border-b border-slate-700 pb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
      <div>
        <h1 class="text-2xl font-black text-cyan-400 tracking-wider">PURIPIWI</h1>
        <p class="text-xs text-slate-400">Sistema de Control y Reparto de Purificadora</p>
      </div>
      
      <!-- Navegación Rápida por Pestañas -->
      <nav class="flex gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
        <a href="/" class="px-3 py-1.5 rounded-lg font-medium transition-colors hover:bg-slate-800 text-slate-300">👥 Mostrador</a>
        <a href="/ruta" class="px-3 py-1.5 rounded-lg font-medium transition-colors hover:bg-slate-800 text-slate-300">🚚 Ruta de Hoy</a>
        <a href="/mantenimiento" class="px-3 py-1.5 rounded-lg font-medium transition-colors hover:bg-slate-800 text-slate-300">⚙️ Equipos & Ventas</a>
      </nav>
    </header>

    {@render children()}
  </main>

  <!-- Footer discreto -->
  <footer class="w-full py-3 px-4 border-t border-slate-800 bg-slate-950 text-slate-500 text-xs flex justify-between items-center">
    <p>Purificadora Control Panel &copy; 2026</p>
    <button 
      onclick={toggleTheme}
      class="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition-colors text-[11px] border border-slate-700 cursor-pointer"
    >
      {darkMode ? '☀️ Modo Claro' : '🌙 Modo Oscuro'}
    </button>
  </footer>
</div>