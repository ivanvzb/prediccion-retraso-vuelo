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
  return d.toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const SOURCE_LABELS = {
  official: "the airline's official estimate",
  inbound_aircraft: "based on the delay of the inbound aircraft",
  no_data: 'not enough data',
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
  const badgeText = predicted === null || predicted === undefined ? 'No known delay' : `~${predicted} min`;
  const sourceLabel = SOURCE_LABELS[data.source] || '';

  let inboundHtml = '';
  if (data.inboundFlight) {
    const ib = data.inboundFlight;
    const ibDelay = ib.arrivalDelay ?? ib.departureDelay;
    inboundHtml = `
      <div class="inbound">
        <h2>Inbound aircraft</h2>
        <p class="inbound-flight">${ib.flightIata ?? '?'} · ${ib.from ?? '?'} → ${ib.to ?? '?'}</p>
        <div class="stats">
          <span>Scheduled arrival: ${formatTime(ib.scheduledArrival)}</span>
          <span>Estimated: ${formatTime(ib.estimatedArrival)}</span>
          <span>Actual: ${formatTime(ib.actualArrival)}</span>
          <span>Delay: ${ibDelay ?? '—'} min</span>
        </div>
        <p class="explain">This aircraft flies ${ib.from ?? '?'} → ${data.departureAirport ?? '?'}, then turns around on the ground to operate your flight ${data.flightNumber}.</p>
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
      <span>Scheduled departure: ${formatTime(data.scheduledDeparture)}</span>
      <span>Status: ${data.status ?? '—'}</span>
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
  button.textContent = 'Checking...';
  result.classList.remove('hidden');
  result.innerHTML = '<p class="info">Looking up the aircraft and its previous flight...</p>';

  try {
    const response = await fetch(`/api/predict?flight=${encodeURIComponent(flightNumber)}`);
    const data = await response.json();
    render(data);
  } catch (err) {
    render({ error: 'Could not connect to the server.' });
  } finally {
    button.disabled = false;
    button.textContent = 'Check';
  }
});
