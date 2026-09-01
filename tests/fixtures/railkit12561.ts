/** A REAL RailKit response for train 12561 departing 01-Sep-2026, trimmed to
 * the stations that matter: the origin, stops already passed, the one it is
 * at now, two upcoming stops that show the recovery projection, the CNBI trap
 * (an intermediate whose code contains CNB), and CNB itself.
 *
 * Captured 02-Sep-2026 via the railkit SDK. Do not hand-edit the values —
 * they are what the vendor actually sends.
 */
export const RAILKIT_12561 = {
  "success": true,
  "data": {
    "trainNo": "12561",
    "trainName": "SWATANTRA S EXP",
    "date": "01-Sep-2026",
    "statusNote": "Arrived at HAJIPUR JN(HJP) at 00:10 02-Sep (Delay: 01:20)",
    "lastUpdate": "02-Sep-2026 00:11",
    "currentStationCode": "HJP",
    "timeline": [
      {
        "type": "stoppage",
        "status": "passed",
        "stationCode": "JYG",
        "stationName": "JAYNAGAR",
        "platform": "1",
        "distanceKm": "",
        "arrival": {
          "scheduled": "SRC",
          "actual": "SRC",
          "delay": ""
        },
        "departure": {
          "scheduled": "17:20 01-Sep",
          "actual": "18:20 01-Sep",
          "delay": "60 Min"
        }
      },
      {
        "type": "stoppage",
        "status": "passed",
        "stationCode": "SPJ",
        "stationName": "SAMASTIPUR JN",
        "platform": "2",
        "distanceKm": "105",
        "arrival": {
          "scheduled": "20:15 01-Sep",
          "actual": "21:20 01-Sep",
          "delay": "01:05 Hr"
        },
        "departure": {
          "scheduled": "20:40 01-Sep",
          "actual": "22:17 01-Sep",
          "delay": "01:37 Hr"
        }
      },
      {
        "type": "stoppage",
        "status": "passed",
        "stationCode": "MFP",
        "stationName": "MUZAFFARPUR JN",
        "platform": "2",
        "distanceKm": "157",
        "arrival": {
          "scheduled": "21:50 01-Sep",
          "actual": "23:16 01-Sep",
          "delay": "01:26 Hr"
        },
        "departure": {
          "scheduled": "21:55 01-Sep",
          "actual": "23:22 01-Sep",
          "delay": "01:27 Hr"
        }
      },
      {
        "type": "stoppage",
        "status": "current",
        "stationCode": "HJP",
        "stationName": "HAJIPUR JN",
        "platform": "3",
        "distanceKm": "211",
        "arrival": {
          "scheduled": "22:50 01-Sep",
          "actual": "00:10 02-Sep",
          "delay": "01:20 Hr"
        },
        "departure": {
          "scheduled": "22:55 01-Sep",
          "actual": "--",
          "delay": ""
        }
      },
      {
        "type": "stoppage",
        "status": "upcoming",
        "stationCode": "SEE",
        "stationName": "SONPUR",
        "platform": "4",
        "distanceKm": "217",
        "arrival": {
          "scheduled": "23:06 01-Sep",
          "actual": "00:20 02-Sep*",
          "delay": "01:14 Hr"
        },
        "departure": {
          "scheduled": "23:08 01-Sep",
          "actual": "00:21 02-Sep*",
          "delay": "01:13 Hr"
        }
      },
      {
        "type": "stoppage",
        "status": "upcoming",
        "stationCode": "CPR",
        "stationName": "CHHAPRA",
        "platform": "1",
        "distanceKm": "270",
        "arrival": {
          "scheduled": "00:35 02-Sep",
          "actual": "00:57 02-Sep*",
          "delay": "22 Min"
        },
        "departure": {
          "scheduled": "00:45 02-Sep",
          "actual": "01:02 02-Sep*",
          "delay": "17 Min"
        }
      },
      {
        "type": "intermediate",
        "status": "upcoming",
        "stationCode": "CNBI",
        "stationName": "CHANDARI"
      },
      {
        "type": "stoppage",
        "status": "upcoming",
        "stationCode": "CNB",
        "stationName": "KANPUR CENTRAL",
        "platform": "2",
        "distanceKm": "794",
        "arrival": {
          "scheduled": "09:35 02-Sep",
          "actual": "09:35 02-Sep*",
          "delay": "On Time"
        },
        "departure": {
          "scheduled": "09:40 02-Sep",
          "actual": "09:40 02-Sep*",
          "delay": "On Time"
        }
      }
    ]
  }
}
