/**
 * REAL RailKit responses captured 14-Oct-2026 via the railkit 6.0.1 SDK
 * (trackTrainV2 and trackTrain), trimmed to the origin, the destination and
 * the stops each test reads. Do not hand-edit the values — they are what the
 * vendor actually sends.
 */

/** v2, 12561 departing 13-Oct, fetched 14-Oct 17:14 after it reached NDLS. CNB is a halt marked departed with NO actual time — the one gap of 21 halts. CNBI (Chandari) sits just before it. */
export const V2_12561_RUN_13OCT = {
  "success": true,
  "data": {
    "startDate": "13-10-2026",
    "lastUpdatedAt": "Oct 14, 2026, 16:56",
    "status": "running",
    "trainInfo": [
      {
        "number": "12561",
        "name": "SWATANTRA S EXP",
        "type": "SUF",
        "category": "express",
        "source": {
          "code": "JYG",
          "name": "Jaynagar",
          "lat": 26.58929,
          "lng": 86.13539
        },
        "destination": {
          "code": "NDLS",
          "name": "New Delhi",
          "lat": 28.64177,
          "lng": 77.22027
        },
        "runDays": [
          "mon",
          "tue",
          "wed",
          "thu",
          "fri",
          "sat",
          "sun"
        ],
        "distance": 1234.62,
        "duration": 1345,
        "avgSpeed": 55.08,
        "totalHalts": 21,
        "coachPosition": "SLRD,GEN,GEN,S1,S2,S3,S4,S5,S6,PC,M1,B1,B2,B3,B4,B5,A1,A2,H1,GEN,GEN,LPR",
        "rakeType": "LHB Rake"
      }
    ],
    "isLive": true,
    "statusText": "At New Delhi (NDLS)",
    "currentLocation": {
      "sequence": 216,
      "stnCode": "NDLS",
      "stnName": "New Delhi",
      "status": "at-station",
      "distanceToNextStationKm": null,
      "nextStation": null,
      "distanceFromOriginKm": 1234.62,
      "distanceFromLastStationKm": 0,
      "delayMinutes": 72
    },
    "previousHalt": {
      "sequence": 208,
      "stnCode": "GZB",
      "stnName": "Ghaziabad Junction",
      "distance": 1209.7
    },
    "nextHalt": null,
    "delayMinutes": 72,
    "route": [
      {
        "sequence": 1,
        "stnCode": "JYG",
        "stnName": "Jaynagar",
        "isHalt": true,
        "status": "departed",
        "distance": 0,
        "platform": "1",
        "day": 1,
        "cord": {
          "lat": 26.58929,
          "lon": 86.13539
        },
        "arrival": {
          "scheduled": "17:20 13-Oct",
          "actual": "SRC",
          "delay": null
        },
        "departure": {
          "scheduled": "17:20 13-Oct",
          "actual": null,
          "delay": null
        }
      },
      {
        "sequence": 117,
        "stnCode": "PRYJ",
        "stnName": "Prayagraj Junction (Allahabad)",
        "isHalt": true,
        "status": "departed",
        "distance": 599.78,
        "platform": "8",
        "day": 1,
        "cord": {
          "lat": 25.444901,
          "lon": 81.83015
        },
        "arrival": {
          "scheduled": "07:00 14-Oct",
          "actual": "07:08 14-Oct",
          "delay": 8
        },
        "departure": {
          "scheduled": "07:10 14-Oct",
          "actual": "07:19 14-Oct",
          "delay": 9
        }
      },
      {
        "sequence": 146,
        "stnCode": "CNBI",
        "stnName": "Chandari",
        "isHalt": false,
        "status": "departed",
        "distance": 790.01,
        "cord": {
          "lat": 26.42796,
          "lon": 80.36008
        },
        "arrival": {
          "scheduled": "09:31 13-Oct",
          "actual": null,
          "delay": null
        },
        "departure": {
          "scheduled": "09:31 13-Oct",
          "actual": null,
          "delay": null
        }
      },
      {
        "sequence": 147,
        "stnCode": "CNB",
        "stnName": "Kanpur Central",
        "isHalt": true,
        "status": "departed",
        "distance": 794.6,
        "platform": "2",
        "day": 1,
        "cord": {
          "lat": 26.454617,
          "lon": 80.350559
        },
        "arrival": {
          "scheduled": "09:35 14-Oct",
          "actual": null,
          "delay": null
        },
        "departure": {
          "scheduled": "09:40 14-Oct",
          "actual": null,
          "delay": null
        }
      },
      {
        "sequence": 190,
        "stnCode": "ALJN",
        "stnName": "Aligarh Junction",
        "isHalt": true,
        "status": "departed",
        "distance": 1106.16,
        "platform": "4",
        "day": 1,
        "cord": {
          "lat": 27.906146,
          "lon": 78.063328
        },
        "arrival": {
          "scheduled": "13:08 14-Oct",
          "actual": "13:52 14-Oct",
          "delay": 44
        },
        "departure": {
          "scheduled": "13:10 14-Oct",
          "actual": "13:54 14-Oct",
          "delay": 44
        }
      },
      {
        "sequence": 216,
        "stnCode": "NDLS",
        "stnName": "New Delhi",
        "isHalt": true,
        "status": "at-station",
        "distance": 1234.46,
        "platform": "12",
        "day": 1,
        "cord": {
          "lat": 28.638437,
          "lon": 77.222686
        },
        "arrival": {
          "scheduled": "15:45 14-Oct",
          "actual": "16:55 14-Oct",
          "delay": 70
        },
        "departure": {
          "scheduled": "15:45 14-Oct",
          "actual": "DSTN",
          "delay": 0
        }
      }
    ],
    "_provider": "wimt"
  }
}

/** v1, the same run fetched the same minute: CNB has 10:00, 25 min late, platform 2. */
export const V1_12561_RUN_13OCT = {
  "success": true,
  "data": {
    "trainNo": "12561",
    "trainName": "SWATANTRA S EXP",
    "date": "13-Oct-2026",
    "statusNote": "Arrived at NEW DELHI(NDLS) at 16:58 14-Oct (Delay: 01:13)",
    "lastUpdate": "14-Oct-2026 16:58",
    "totalStations": 211,
    "totalStoppageStations": 21,
    "currentStationCode": "NDLS",
    "totalDistanceKm": 1235,
    "averageSpeedKmph": 55.09,
    "progress": {
      "journeyStatus": "completed",
      "currentStationIndex": 211,
      "totalStations": 211,
      "passedStations": 211,
      "remainingStations": 0,
      "currentDistanceKm": 1235,
      "distanceRemainingKm": 0,
      "percent": 100
    },
    "timeline": [
      {
        "type": "stoppage",
        "status": "passed",
        "stationCode": "JYG",
        "stationName": "JAYNAGAR",
        "platform": "1",
        "distanceKm": "0",
        "arrival": {
          "scheduled": "SRC",
          "actual": "SRC",
          "delay": ""
        },
        "departure": {
          "scheduled": "17:20 13-Oct",
          "actual": "17:20 13-Oct",
          "delay": "On Time"
        }
      },
      {
        "type": "stoppage",
        "status": "passed",
        "stationCode": "PRYJ",
        "stationName": "PRAYAGRAJ JN",
        "platform": "7",
        "distanceKm": "600",
        "arrival": {
          "scheduled": "07:00 14-Oct",
          "actual": "07:10 14-Oct",
          "delay": "10 min"
        },
        "departure": {
          "scheduled": "07:10 14-Oct",
          "actual": "07:15 14-Oct",
          "delay": "5 min"
        }
      },
      {
        "type": "intermediate",
        "status": "passed",
        "stationCode": "CNBI",
        "stationName": "CHANDARI",
        "distanceKm": "790"
      },
      {
        "type": "stoppage",
        "status": "passed",
        "stationCode": "CNB",
        "stationName": "KANPUR CENTRAL",
        "platform": "2",
        "distanceKm": "794",
        "arrival": {
          "scheduled": "09:35 14-Oct",
          "actual": "10:00 14-Oct",
          "delay": "25 min"
        },
        "departure": {
          "scheduled": "09:40 14-Oct",
          "actual": "10:09 14-Oct",
          "delay": "29 min"
        }
      },
      {
        "type": "stoppage",
        "status": "passed",
        "stationCode": "ALJN",
        "stationName": "ALIGARH JN",
        "platform": "4",
        "distanceKm": "1103",
        "arrival": {
          "scheduled": "13:08 14-Oct",
          "actual": "13:50 14-Oct",
          "delay": "42 min"
        },
        "departure": {
          "scheduled": "13:10 14-Oct",
          "actual": "13:52 14-Oct",
          "delay": "42 min"
        }
      },
      {
        "type": "stoppage",
        "status": "current",
        "stationCode": "NDLS",
        "stationName": "NEW DELHI",
        "platform": "12",
        "distanceKm": "1235",
        "arrival": {
          "scheduled": "15:45 14-Oct",
          "actual": "16:58 14-Oct",
          "delay": "01:13 Hr"
        },
        "departure": {
          "scheduled": "DSTN",
          "actual": "DSTN",
          "delay": ""
        }
      }
    ]
  }
}

/** v2, 22466 departing 14-Oct, fetched 17:39 at Panki Dham: CNB projected 17:48, 13 late, with NO platform. */
export const V2_22466_1739 = {
  "success": true,
  "data": {
    "startDate": "14-10-2026",
    "lastUpdatedAt": "Oct 14, 2026, 17:39",
    "status": "running",
    "trainInfo": [
      {
        "number": "22466",
        "name": "BABA V DHAM EXP",
        "type": "SUF",
        "category": "express",
        "source": {
          "code": "ANVT",
          "name": "Anand Vihar Terminal",
          "lat": 28.64925,
          "lng": 77.315032
        },
        "destination": {
          "code": "MDP",
          "name": "Madhupur Junction",
          "lat": 24.27097,
          "lng": 86.64248
        },
        "runDays": [
          "wed"
        ],
        "distance": 416.92,
        "duration": 1010,
        "avgSpeed": 24.77,
        "totalHalts": 12,
        "coachPosition": "L,EOG,GS,GS,A1,A2,M1,M2,B1,B2,B3,B4,S1,S2,S3,S4,S5,S6,GS,GS,GS,SLR,L",
        "rakeType": "LHB Rake"
      }
    ],
    "isLive": true,
    "statusText": "At Panki Dham (PNKD)",
    "currentLocation": {
      "sequence": 60,
      "stnCode": "PNKD",
      "stnName": "Panki Dham",
      "status": "at-station",
      "distanceToNextStationKm": 10.98,
      "nextStation": {
        "sequence": 64,
        "stnCode": "CNB",
        "stnName": "Kanpur Central"
      },
      "distanceFromOriginKm": 416.92,
      "distanceFromLastStationKm": 0,
      "delayMinutes": 13
    },
    "previousHalt": {
      "sequence": 1,
      "stnCode": "ANVT",
      "stnName": "Anand Vihar Terminal",
      "distance": 0.83
    },
    "nextHalt": {
      "sequence": 64,
      "stnCode": "CNB",
      "stnName": "Kanpur Central",
      "distance": 427.9
    },
    "delayMinutes": 13,
    "route": [
      {
        "sequence": 1,
        "stnCode": "ANVT",
        "stnName": "Anand Vihar Terminal",
        "isHalt": true,
        "status": "departed",
        "distance": 0.83,
        "platform": "2",
        "day": 1,
        "cord": {
          "lat": 28.652787,
          "lon": 77.322088
        },
        "arrival": {
          "scheduled": "12:40 14-Oct",
          "actual": "SRC",
          "delay": null
        },
        "departure": {
          "scheduled": "12:40 14-Oct",
          "actual": "12:45 14-Oct",
          "delay": 5
        }
      },
      {
        "sequence": 59,
        "stnCode": "BPU",
        "stnName": "Bhaupur",
        "isHalt": false,
        "status": "departed",
        "distance": 405.31,
        "cord": {
          "lat": 26.46857,
          "lon": 80.12517
        },
        "arrival": {
          "scheduled": "17:19 14-Oct",
          "actual": null,
          "delay": null
        },
        "departure": {
          "scheduled": "17:19 14-Oct",
          "actual": null,
          "delay": null
        }
      },
      {
        "sequence": 60,
        "stnCode": "PNKD",
        "stnName": "Panki Dham",
        "isHalt": false,
        "status": "at-station",
        "distance": 416.92,
        "cord": {
          "lat": 26.459553,
          "lon": 80.240566
        },
        "arrival": {
          "scheduled": "17:27 14-Oct",
          "actual": "17:39 14-Oct",
          "delay": 12
        },
        "departure": {
          "scheduled": "17:27 14-Oct",
          "actual": "17:39 14-Oct",
          "delay": 13
        }
      },
      {
        "sequence": 63,
        "stnCode": "GMC",
        "stnName": "Kanpur Goods Marshalling Yard",
        "isHalt": false,
        "status": "upcoming",
        "distance": 426.74,
        "cord": {
          "lat": 26.452144,
          "lon": 80.339866
        },
        "arrival": {
          "scheduled": "17:34 14-Oct",
          "actual": null,
          "delay": null
        },
        "departure": {
          "scheduled": "17:34 14-Oct",
          "actual": null,
          "delay": null
        }
      },
      {
        "sequence": 64,
        "stnCode": "CNB",
        "stnName": "Kanpur Central",
        "isHalt": true,
        "status": "upcoming",
        "distance": 427.9,
        "platform": null,
        "day": 1,
        "cord": {
          "lat": 26.454617,
          "lon": 80.350559
        },
        "arrival": {
          "scheduled": "17:35 14-Oct",
          "actual": "17:48 14-Oct",
          "delay": 13
        },
        "departure": {
          "scheduled": "17:40 14-Oct",
          "actual": "17:53 14-Oct",
          "delay": 13
        }
      },
      {
        "sequence": 65,
        "stnCode": "CNBI",
        "stnName": "Chandari",
        "isHalt": false,
        "status": "upcoming",
        "distance": 432.5,
        "cord": {
          "lat": 26.42796,
          "lon": 80.36008
        },
        "arrival": {
          "scheduled": "17:42 14-Oct",
          "actual": null,
          "delay": null
        },
        "departure": {
          "scheduled": "17:42 14-Oct",
          "actual": null,
          "delay": null
        }
      },
      {
        "sequence": 94,
        "stnCode": "PRYJ",
        "stnName": "Prayagraj Junction (Allahabad)",
        "isHalt": true,
        "status": "upcoming",
        "distance": 622.4,
        "platform": "4",
        "day": 1,
        "cord": {
          "lat": 25.44572,
          "lon": 81.82639
        },
        "arrival": {
          "scheduled": "19:45 14-Oct",
          "actual": "19:58 14-Oct",
          "delay": 13
        },
        "departure": {
          "scheduled": "19:47 14-Oct",
          "actual": "20:07 14-Oct",
          "delay": 20
        }
      },
      {
        "sequence": 244,
        "stnCode": "MDP",
        "stnName": "Madhupur Junction",
        "isHalt": true,
        "status": "upcoming",
        "distance": 1236.2,
        "platform": "3",
        "day": 1,
        "cord": {
          "lat": 24.27097,
          "lon": 86.64248
        },
        "arrival": {
          "scheduled": "05:30 15-Oct",
          "actual": "05:16 15-Oct",
          "delay": 0
        },
        "departure": {
          "scheduled": "05:30 15-Oct",
          "actual": "DSTN",
          "delay": 0
        }
      }
    ],
    "_provider": "wimt"
  }
}

/** v1, 22466 fetched the same minute: CNB projected 17:46*, platform 6. */
export const V1_22466_1739 = {
  "success": true,
  "data": {
    "trainNo": "22466",
    "trainName": "BABA V DHAM EXP",
    "date": "14-Oct-2026",
    "statusNote": "Departed from BHAUPUR(BPU) at 17:33 14-Oct",
    "lastUpdate": "14-Oct-2026 17:34",
    "totalStations": 240,
    "totalStoppageStations": 12,
    "currentStationCode": "BPU",
    "totalDistanceKm": 1232,
    "averageSpeedKmph": 73.19,
    "progress": {
      "journeyStatus": "running",
      "currentStationIndex": 58,
      "totalStations": 240,
      "passedStations": 57,
      "remainingStations": 182,
      "currentDistanceKm": 405,
      "distanceRemainingKm": 827,
      "percent": 32.87
    },
    "timeline": [
      {
        "type": "stoppage",
        "stationCode": "ANVT",
        "stationName": "ANAND VIHAR TERMINAL",
        "platform": "2",
        "distanceKm": "0",
        "arrival": {
          "scheduled": "SRC",
          "actual": "SRC",
          "delay": ""
        },
        "departure": {
          "scheduled": "12:40 14-Oct",
          "actual": "12:40 14-Oct",
          "delay": "On Time"
        },
        "status": "passed"
      },
      {
        "type": "intermediate",
        "status": "current",
        "stationCode": "BPU",
        "stationName": "BHAUPUR",
        "distanceKm": "405"
      },
      {
        "type": "stoppage",
        "stationCode": "CNB",
        "stationName": "KANPUR CENTRAL",
        "platform": "6",
        "distanceKm": "428",
        "arrival": {
          "scheduled": "17:35 14-Oct",
          "actual": "17:46 14-Oct*",
          "delay": "11 Min"
        },
        "departure": {
          "scheduled": "17:40 14-Oct",
          "actual": "17:47 14-Oct*",
          "delay": "7 Min"
        },
        "status": "upcoming"
      },
      {
        "type": "stoppage",
        "stationCode": "PRYJ",
        "stationName": "PRAYAGRAJ JN",
        "platform": "4",
        "distanceKm": "622",
        "arrival": {
          "scheduled": "19:45 14-Oct",
          "actual": "19:45 14-Oct*",
          "delay": "On Time"
        },
        "departure": {
          "scheduled": "19:47 14-Oct",
          "actual": "19:47 14-Oct*",
          "delay": "On Time"
        },
        "status": "upcoming"
      },
      {
        "type": "stoppage",
        "stationCode": "MDP",
        "stationName": "MADHUPUR JN",
        "platform": "3",
        "distanceKm": "1232",
        "arrival": {
          "scheduled": "05:30 15-Oct",
          "actual": "05:30 15-Oct*",
          "delay": "On Time"
        },
        "departure": {
          "scheduled": "DSTN",
          "actual": "DSTN",
          "delay": ""
        },
        "status": "upcoming"
      }
    ]
  }
}

/** v2, 16093 departing 13-Oct, fetched 17:46 near Chandari Junction: CNB projected 17:52 against an 18:25 timetable, delay floored at 0. */
export const V2_16093_1746 = {
  "success": true,
  "data": {
    "startDate": "13-10-2026",
    "lastUpdatedAt": "Oct 14, 2026, 17:46",
    "status": "running",
    "trainInfo": [
      {
        "number": "16093",
        "name": "Lucknow Jn. MAS LJN EXPRESS",
        "type": "MEX",
        "category": "express",
        "source": {
          "code": "MAS",
          "name": "MGR Chennai Central",
          "lat": 13.083847,
          "lng": 80.275512
        },
        "destination": {
          "code": "LJN",
          "name": "Lucknow Junction NER",
          "lat": 26.83206,
          "lng": 80.92161
        },
        "runDays": [
          "tue",
          "sat"
        ],
        "distance": 2010.82,
        "duration": 2350,
        "avgSpeed": 51.34,
        "totalHalts": 46,
        "coachPosition": "VP,SLRD,GEN,GEN,S7,S6,S5,S4,S3,S2,S1,BE1,B3,B2,B1,A1,GEN,GEN,LPR",
        "rakeType": "LHB Rake"
      }
    ],
    "isLive": true,
    "statusText": "6.09 km to Govindpuri (Kanpur) (GOY)",
    "currentLocation": {
      "sequence": 305,
      "stnCode": "CNJW",
      "stnName": "Holding Line",
      "status": "departed",
      "distanceToNextStationKm": 8.09,
      "nextStation": {
        "sequence": 309,
        "stnCode": "CNB",
        "stnName": "Kanpur Central"
      },
      "distanceFromOriginKm": 2010.82,
      "distanceFromLastStationKm": 4.72,
      "delayMinutes": null
    },
    "previousHalt": {
      "sequence": 297,
      "stnCode": "PHN",
      "stnName": "Pokhrayan",
      "distance": 1956.95
    },
    "nextHalt": {
      "sequence": 309,
      "stnCode": "CNB",
      "stnName": "Kanpur Central",
      "distance": 2015.6
    },
    "delayMinutes": null,
    "route": [
      {
        "sequence": 1,
        "stnCode": "MAS",
        "stnName": "MGR Chennai Central",
        "isHalt": true,
        "status": "departed",
        "distance": 0,
        "platform": "6",
        "day": 1,
        "cord": {
          "lat": 13.083847,
          "lon": 80.275512
        },
        "arrival": {
          "scheduled": "05:10 13-Oct",
          "actual": "SRC",
          "delay": null
        },
        "departure": {
          "scheduled": "05:10 13-Oct",
          "actual": null,
          "delay": null
        }
      },
      {
        "sequence": 297,
        "stnCode": "PHN",
        "stnName": "Pokhrayan",
        "isHalt": true,
        "status": "departed",
        "distance": 1956.95,
        "platform": "1",
        "day": 2,
        "cord": {
          "lat": 26.222062,
          "lon": 79.839948
        },
        "arrival": {
          "scheduled": "16:05 14-Oct",
          "actual": "16:22 14-Oct",
          "delay": 17
        },
        "departure": {
          "scheduled": "16:07 14-Oct",
          "actual": "16:25 14-Oct",
          "delay": 18
        }
      },
      {
        "sequence": 305,
        "stnCode": "CNJW",
        "stnName": "Holding Line",
        "isHalt": false,
        "status": "departed",
        "distance": 2007.51,
        "cord": {
          "lat": 26.441796,
          "lon": 80.27292
        },
        "arrival": {
          "scheduled": "18:02 14-Oct",
          "actual": "17:08 14-Oct",
          "delay": 0
        },
        "departure": {
          "scheduled": "18:02 14-Oct",
          "actual": "17:08 14-Oct",
          "delay": 0
        }
      },
      {
        "sequence": 308,
        "stnCode": "GMC",
        "stnName": "Kanpur Goods Marshalling Yard",
        "isHalt": false,
        "status": "upcoming",
        "distance": 2019.6,
        "cord": {
          "lat": 26.452144,
          "lon": 80.339866
        },
        "arrival": {
          "scheduled": "18:22 14-Oct",
          "actual": null,
          "delay": null
        },
        "departure": {
          "scheduled": "18:22 14-Oct",
          "actual": null,
          "delay": null
        }
      },
      {
        "sequence": 309,
        "stnCode": "CNB",
        "stnName": "Kanpur Central",
        "isHalt": true,
        "status": "upcoming",
        "distance": 2015.6,
        "platform": "6",
        "day": 2,
        "cord": {
          "lat": 26.454617,
          "lon": 80.350559
        },
        "arrival": {
          "scheduled": "18:25 14-Oct",
          "actual": "17:52 14-Oct",
          "delay": 0
        },
        "departure": {
          "scheduled": "18:30 14-Oct",
          "actual": "17:57 14-Oct",
          "delay": 0
        }
      },
      {
        "sequence": 322,
        "stnCode": "LJN",
        "stnName": "Lucknow Junction NER",
        "isHalt": true,
        "status": "upcoming",
        "distance": 2087.6,
        "platform": "3",
        "day": 2,
        "cord": {
          "lat": 26.83206,
          "lon": 80.92161
        },
        "arrival": {
          "scheduled": "20:20 14-Oct",
          "actual": "19:35 14-Oct",
          "delay": 0
        },
        "departure": {
          "scheduled": "20:20 14-Oct",
          "actual": "DSTN",
          "delay": 0
        }
      }
    ],
    "_provider": "wimt"
  }
}
