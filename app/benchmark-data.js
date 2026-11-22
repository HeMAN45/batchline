export const publicBenchmark = {
  "dataset": "UCI Online Retail",
  "referenceMonth": "2011-09",
  "heldOut": [
    {
      "month": "2011-10",
      "rows": 59764,
      "corruptions": 201,
      "driftFlags": [],
      "policies": [
        {
          "name": "Raw import",
          "detection": 0,
          "precision": 0,
          "recovery": 0,
          "falseEdits": 0,
          "held": 0,
          "review": 0,
          "revenueError": 2346.47
        },
        {
          "name": "Original studio defaults",
          "detection": 0.39800995024875624,
          "precision": 0.0010416937941092215,
          "recovery": 0.3880597014925373,
          "falseEdits": 73303,
          "held": 0,
          "review": 3609,
          "revenueError": 2346.47
        },
        {
          "name": "Contract gate",
          "detection": 1,
          "precision": 1,
          "recovery": 0.40298507462686567,
          "falseEdits": 0,
          "held": 160,
          "review": 40,
          "revenueError": 1723.44
        },
        {
          "name": "Gate + simulated review",
          "detection": 1,
          "precision": 1,
          "recovery": 0.6019900497512438,
          "falseEdits": 0,
          "held": 120,
          "review": 0,
          "revenueError": 1192.08
        }
      ]
    },
    {
      "month": "2011-11",
      "rows": 83152,
      "corruptions": 201,
      "driftFlags": [],
      "policies": [
        {
          "name": "Raw import",
          "detection": 0,
          "precision": 0,
          "recovery": 0,
          "falseEdits": 0,
          "held": 0,
          "review": 0,
          "revenueError": 2138.5
        },
        {
          "name": "Original studio defaults",
          "detection": 0.39800995024875624,
          "precision": 0.0007449344457687723,
          "recovery": 0.3880597014925373,
          "falseEdits": 100241,
          "held": 0,
          "review": 7356,
          "revenueError": 2138.5
        },
        {
          "name": "Contract gate",
          "detection": 1,
          "precision": 1,
          "recovery": 0.40298507462686567,
          "falseEdits": 0,
          "held": 160,
          "review": 40,
          "revenueError": 1999.66
        },
        {
          "name": "Gate + simulated review",
          "detection": 1,
          "precision": 1,
          "recovery": 0.6019900497512438,
          "falseEdits": 0,
          "held": 120,
          "review": 0,
          "revenueError": 1233.69
        }
      ]
    },
    {
      "month": "2011-12",
      "rows": 25206,
      "corruptions": 201,
      "driftFlags": [],
      "policies": [
        {
          "name": "Raw import",
          "detection": 0,
          "precision": 0,
          "recovery": 0,
          "falseEdits": 0,
          "held": 0,
          "review": 0,
          "revenueError": 1850.45
        },
        {
          "name": "Original studio defaults",
          "detection": 0.39800995024875624,
          "precision": 0.002413928366675719,
          "recovery": 0.39800995024875624,
          "falseEdits": 30755,
          "held": 0,
          "review": 2537,
          "revenueError": 1850.45
        },
        {
          "name": "Contract gate",
          "detection": 1,
          "precision": 1,
          "recovery": 0.40298507462686567,
          "falseEdits": 0,
          "held": 160,
          "review": 40,
          "revenueError": 1858.22
        },
        {
          "name": "Gate + simulated review",
          "detection": 1,
          "precision": 1,
          "recovery": 0.6019900497512438,
          "falseEdits": 0,
          "held": 120,
          "review": 0,
          "revenueError": 1120.41
        }
      ]
    }
  ]
};
