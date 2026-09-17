const form = document.getElementById('search-form');
const input = document.getElementById('flight-input');
const result = document.getElementById('result');

function delayClass(minutes) {
  if (minutes === null || minutes === undefined) return 'warn';
  if (minutes <= 10) return 'good';
  if (minutes <= 30) return 'warn';
  return 'bad';
}

function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const SOURCE_LABELS = {
  oficial: 'estimación oficial de la aerolínea',
  avion_entrante: 'según el retraso del avión que llega antes',
  sin_datos: 'sin datos suficientes',
};

function render(data) {
  result.classList.remove('hidden');

  if (data.error) {
    result.innerHTML = `<p class="error">${data.error}</p>`;
    return;
  }

  if (!data.found) {
    result.innerHTML = `<p class="info">${data.message}</p>`;
    return;
  }

  const predicted = data.predictedDelayMinutes;
  const cls = delayClass(predicted);
  const badgeText = predicted === null || predicted === undefined ? 'Sin retraso conocido' : `~${predicted} min`;
  const sourceLabel = SOURCE_LABELS[data.source] || '';

  let inboundHtml = '';
  if (data.inboundFlight) {
    const ib = data.inboundFlight;
    const ibDelay = ib.arrivalDelay ?? ib.departureDelay;
    inboundHtml = `
      <div class="inbound">
        <h2>Avión entrante</h2>
        <p class="inbound-flight">${ib.flightIata ?? '?'} · ${ib.from ?? '?'} → ${ib.to ?? '?'}</p>
        <div class="stats">
          <span>Llegada prevista: ${formatTime(ib.scheduledArrival)}</span>
          <span>Estimada: ${formatTime(ib.estimatedArrival)}</span>
          <span>Real: ${formatTime(ib.actualArrival)}</span>
          <span>Retraso: ${ibDelay ?? '—'} min</span>
        </div>
        <p class="explain">Este avión hace la ruta ${ib.from ?? '?'} → ${data.departureAirport ?? '?'} y luego, ya en tierra, opera tu vuelo ${data.flightNumber}.</p>
      </div>
    `;
  }

  const message = data.message ? `<p class="info">${data.message}</p>` : '';

  result.innerHTML = `
    <div class="delay-badge ${cls}">
      ${badgeText} <span>${sourceLabel}</span>
    </div>
    <div class="stats">
      <span>${data.departureAirport ?? '?'} → ${data.arrivalAirport ?? '?'}</span>
      <span>Salida prevista: ${formatTime(data.scheduledDeparture)}</span>
      <span>Estado: ${data.status ?? '—'}</span>
    </div>
    ${inboundHtml}
    ${message}
  `;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const flightNumber = input.value.trim();
  if (!flightNumber) return;

  const button = form.querySelector('button');
  button.disabled = true;
  button.textContent = 'Consultando...';
  result.classList.remove('hidden');
  result.innerHTML = '<p class="info">Buscando el avión y su vuelo anterior...</p>';

  try {
    const response = await fetch(`/api/predict?flight=${encodeURIComponent(flightNumber)}`);
    const data = await response.json();
    render(data);
  } catch (err) {
    render({ error: 'No se pudo conectar con el servidor.' });
  } finally {
    button.disabled = false;
    button.textContent = 'Consultar';
  }
});
