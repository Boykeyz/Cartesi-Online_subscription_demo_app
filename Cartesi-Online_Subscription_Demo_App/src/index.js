const { ethers } = require("ethers");
const { toUtf8String, hexlify, toUtf8Bytes } = ethers.utils;
const fetch = require('node-fetch');

// In-memory database for storing users and their subscription status
let users = {};

// Helper functions for hex conversion
function hex2Object(hex) {
  const utf8String = toUtf8String(hex);
  return JSON.parse(utf8String);
}

function obj2Hex(obj) {
  const jsonString = JSON.stringify(obj);
  return hexlify(toUtf8Bytes(jsonString));
}

function isNumeric(num) {
  return !isNaN(num);
}

// Function to subscribe a user
function subscribeUser(userId, amount) {
  if (!users[userId]) {
    users[userId] = { subscribed: true, expiryDate: getExpiryDate(), balance: amount };
    return `User ${userId} successfully subscribed. Subscription valid until ${users[userId].expiryDate}.`;
  } else {
    return `User ${userId} is already subscribed.`;
  }
}

// Function to check subscription status
function checkSubscription(userId) {
  if (!users[userId]) {
    return `User ${userId} is not subscribed.`;
  }
  
  const currentDate = new Date();
  if (new Date(users[userId].expiryDate) > currentDate) {
    return `User ${userId} is subscribed until ${users[userId].expiryDate}.`;
  } else {
    users[userId].subscribed = false;
    return `User ${userId}'s subscription has expired.`;
  }
}

// Function to process payment and extend subscription
function processPayment(userId, amount) {
  if (!users[userId]) {
    return `User ${userId} is not subscribed. Please subscribe first.`;
  }

  if (amount < 10) {
    return `Insufficient amount. Minimum amount required is 10.`;
  }

  users[userId].expiryDate = extendExpiryDate(users[userId].expiryDate);
  users[userId].balance += amount;
  return `Payment of ${amount} received. Subscription extended until ${users[userId].expiryDate}.`;
}

// Helper function to get the expiry date (one month from today)
function getExpiryDate() {
  const currentDate = new Date();
  currentDate.setMonth(currentDate.getMonth() + 1);
  return currentDate.toISOString().split('T')[0];
}

// Helper function to extend the expiry date by one month
function extendExpiryDate(currentExpiryDate) {
  const newExpiryDate = new Date(currentExpiryDate);
  newExpiryDate.setMonth(newExpiryDate.getMonth() + 1);
  return newExpiryDate.toISOString().split('T')[0];
}

// Rollup input handler
async function handleInput(input) {
  const [command, userId, amount] = input.payload.split(" ");
  let response;

  switch (command) {
    case "subscribe":
      response = subscribeUser(userId, parseFloat(amount));
      break;
    case "check":
      response = checkSubscription(userId);
      break;
    case "pay":
      response = processPayment(userId, parseFloat(amount));
      break;
    default:
      response = "Invalid command. Use 'subscribe', 'check', or 'pay'.";
  }

  await input.sendResponse(response);
};

let user = [];
let total_operations = 0;
const rollup_server = "http://localhost:5000"; // Example server URL

async function handle_advance(data) {
  console.log("Received advance request data " + JSON.stringify(data));

  const metadata = data['metadata'];
  const sender = metadata['msg_sender'];
  const payload = data['payload'];

  let subscription_input = hex2Object(payload);

  if (typeof subscription_input !== 'object') {
    const report_req = await fetch(rollup_server + "/report", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ payload: obj2Hex("Object is not in hex format") }),
    });

    return "reject";
  }

  users[sender] = subscription_input;
  total_operations += 1;

  const subscription_output = await handleInput(subscription_input);

  const notice_req = await fetch(rollup_server + "/notice", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ payload: obj2Hex(subscription_output) }),
  });
  return "accept";
}

async function handle_inspect(data) {
  console.log("Received inspect request data " + JSON.stringify(data));

  const payload = data['payload'];
  const route = hex2str(payload);

  let responseObject = {};
  if (route === "list") {
    responseObject = JSON.stringify({ user });
  } else if (route === "total") {
    responseObject = JSON.stringify({ total_operations });
  } else {
    responseObject= "route not implemented"
  }

  const report_req = await fetch(rollup_server + "/report", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ payload: str2hex(responseObject) }),
  });

  return "accept";
}

var handlers = {
  advance_state: handle_advance,
  inspect_state: handle_inspect,
};

var finish = { status: "accept" };

(async () => {
  while (true) {
    const finish_req = await fetch(rollup_server + "/finish", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "accept" }),
    });

    console.log("Received finish status " + finish_req.status);

    if (finish_req.status == 202) {
      console.log("No pending rollup request, trying again");
    } else {
      const rollup_req = await finish_req.json();
      var handler = handlers[rollup_req["request_type"]];
      finish["status"] = await handler(rollup_req["data"]);
    }
  }
})();