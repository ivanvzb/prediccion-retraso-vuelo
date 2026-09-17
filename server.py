import os
import urllib.parse
import urllib.request
import json
from datetime import datetime

from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory

load_dotenv()

API_KEY = os.environ.get("AVIATIONSTACK_API_KEY")
BASE_URL = "http://api.aviationstack.com/v1/flights"

app = Flask(__name__, static_folder="public", static_url_path="")


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


def call_aviationstack(params):
    query = {"access_key": API_KEY, **params}
    url = BASE_URL + "?" + urllib.parse.urlencode(query)
    with urllib.request.urlopen(url, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def parse_iso(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


@app.get("/api/predict")
def predict():
    flight_number = (request.args.get("flight") or "").strip().upper()

    if not flight_number:
        return jsonify({"error": "Please enter a flight number."}), 400
    if not API_KEY:
        return jsonify({"error": "AVIATIONSTACK_API_KEY is not configured on the server."}), 500

    try:
        target_data = call_aviationstack({"flight_iata": flight_number, "limit": "20"})
    except Exception:
        return jsonify({"error": "Could not reach the flight data API."}), 502

    if target_data.get("error"):
        return jsonify({"error": target_data["error"].get("message", "Error querying the flight data API.")}), 502

    candidates = target_data.get("data") or []
    if not candidates:
        return jsonify({
            "flightNumber": flight_number,
            "found": False,
            "message": "Flight not found. Check the IATA code (e.g. KL1508, BA5817).",
        })

    # There can be several codeshare entries; keep the one that matches exactly.
    primary = next(
        (f for f in candidates if ((f.get("flight") or {}).get("iata") or "").upper() == flight_number),
        candidates[0],
    )

    dep = primary.get("departure") or {}
    arr = primary.get("arrival") or {}
    airline = primary.get("airline") or {}
    aircraft = primary.get("aircraft") or {}
    icao24 = aircraft.get("icao24")
    flight_date = primary.get("flight_date")
    dep_scheduled = dep.get("scheduled")

    result = {
        "flightNumber": flight_number,
        "found": True,
        "flightDate": flight_date,
        "status": primary.get("flight_status"),
        "airline": airline.get("name"),
        "departureAirport": dep.get("iata"),
        "arrivalAirport": arr.get("iata"),
        "scheduledDeparture": dep_scheduled,
        "currentDepartureDelay": dep.get("delay"),
        "aircraftIcao24": icao24,
    }

    if not icao24:
        result["message"] = "No aircraft has been assigned to this flight yet. Try again closer to departure."
        result["predictedDelayMinutes"] = result["currentDepartureDelay"]
        result["source"] = "official" if result["currentDepartureDelay"] is not None else "no_data"
        return jsonify(result)

    # Among the flights landing at this airport the same day with the same airline,
    # find the one bringing in the SAME aircraft (same icao24) right before our flight departs.
    try:
        # Note: aviationstack's free plan returns 403 when combined with "flight_date",
        # so we rely only on comparing timestamps to pick the previous leg.
        inbound_data = call_aviationstack({
            "arr_icao": dep.get("icao") or "",
            "airline_iata": airline.get("iata") or "",
            "limit": "100",
        })
    except Exception:
        inbound_data = {}

    dep_dt = parse_iso(dep_scheduled)
    inbound = None
    inbound_arr_dt = None
    for f in inbound_data.get("data") or []:
        if (f.get("aircraft") or {}).get("icao24") != icao24:
            continue
        f_arr_dt = parse_iso((f.get("arrival") or {}).get("scheduled"))
        if not f_arr_dt or (dep_dt and f_arr_dt >= dep_dt):
            continue
        if inbound is None or f_arr_dt > inbound_arr_dt:
            inbound = f
            inbound_arr_dt = f_arr_dt

    if inbound:
        i_dep = inbound.get("departure") or {}
        i_arr = inbound.get("arrival") or {}
        i_flight = inbound.get("flight") or {}
        inbound_delay = i_arr.get("delay")
        if inbound_delay is None:
            inbound_delay = i_dep.get("delay")

        result["inboundFlight"] = {
            "flightIata": i_flight.get("iata"),
            "from": i_dep.get("iata"),
            "to": i_arr.get("iata"),
            "status": inbound.get("flight_status"),
            "scheduledArrival": i_arr.get("scheduled"),
            "estimatedArrival": i_arr.get("estimated"),
            "actualArrival": i_arr.get("actual"),
            "arrivalDelay": i_arr.get("delay"),
            "departureDelay": i_dep.get("delay"),
        }

        if result["currentDepartureDelay"] is not None:
            result["predictedDelayMinutes"] = result["currentDepartureDelay"]
            result["source"] = "official"
        else:
            result["predictedDelayMinutes"] = inbound_delay
            result["source"] = "inbound_aircraft"
    else:
        result["predictedDelayMinutes"] = result["currentDepartureDelay"]
        result["source"] = "official" if result["currentDepartureDelay"] is not None else "no_data"
        result["message"] = "We couldn't identify this aircraft's previous inbound flight (it may arrive with a different airline or not be scheduled yet)."

    return jsonify(result)


if __name__ == "__main__":
    port = int(os.environ.get("PORT") or 3000)
    app.run(host="0.0.0.0", port=port, debug=True)
