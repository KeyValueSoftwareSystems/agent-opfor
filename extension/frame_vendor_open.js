// Runs in MAIN world to open chat widgets via vendor-specific JavaScript APIs.
(() => {
  // Salesforce Embedded Service
  try {
    if (typeof window.embedded_svc !== "undefined") {
      if (typeof window.embedded_svc.liveAgentAPI?.startChat === "function") {
        window.embedded_svc.liveAgentAPI.startChat();
        return { ok: true, vendor: "salesforce", method: "embedded_svc.startChat" };
      }
    }
    if (typeof window.embeddedservice_bootstrap !== "undefined") {
      if (typeof window.embeddedservice_bootstrap.utilAPI?.launchChat === "function") {
        window.embeddedservice_bootstrap.utilAPI.launchChat();
        return { ok: true, vendor: "salesforce", method: "embeddedservice_bootstrap.launchChat" };
      }
    }
  } catch {}

  // Gorgias
  try {
    if (typeof window.GorgiasChat !== "undefined" && typeof window.GorgiasChat.open === "function") {
      window.GorgiasChat.open();
      return { ok: true, vendor: "gorgias", method: "GorgiasChat.open" };
    }
    if (typeof window.gorgias !== "undefined" && typeof window.gorgias.open === "function") {
      window.gorgias.open();
      return { ok: true, vendor: "gorgias", method: "gorgias.open" };
    }
  } catch {}

  // Zendesk
  try {
    if (typeof window.zE === "function") {
      try { window.zE("messenger", "open"); } catch { try { window.zE("webWidget", "open"); } catch {} }
      return { ok: true, vendor: "zendesk", method: "zE" };
    }
  } catch {}

  // Intercom
  try {
    if (typeof window.Intercom === "function") {
      window.Intercom("show");
      return { ok: true, vendor: "intercom", method: "Intercom.show" };
    }
  } catch {}

  // Drift
  try {
    if (typeof window.drift !== "undefined" && typeof window.drift.api?.openChat === "function") {
      window.drift.api.openChat();
      return { ok: true, vendor: "drift", method: "drift.api.openChat" };
    }
  } catch {}

  // Crisp
  try {
    if (typeof window.$crisp !== "undefined") {
      window.$crisp.push(["do", "chat:open"]);
      return { ok: true, vendor: "crisp", method: "$crisp.chat:open" };
    }
  } catch {}

  // Tidio
  try {
    if (typeof window.tidioChatApi !== "undefined" && typeof window.tidioChatApi.open === "function") {
      window.tidioChatApi.open();
      return { ok: true, vendor: "tidio", method: "tidioChatApi.open" };
    }
  } catch {}

  // Freshchat
  try {
    if (typeof window.fcWidget !== "undefined" && typeof window.fcWidget.open === "function") {
      window.fcWidget.open();
      return { ok: true, vendor: "freshchat", method: "fcWidget.open" };
    }
  } catch {}

  // Tawk.to
  try {
    if (typeof window.Tawk_API !== "undefined" && typeof window.Tawk_API.maximize === "function") {
      window.Tawk_API.maximize();
      return { ok: true, vendor: "tawk", method: "Tawk_API.maximize" };
    }
  } catch {}

  // HubSpot
  try {
    if (typeof window.HubSpotConversations !== "undefined") {
      window.HubSpotConversations.widget.open();
      return { ok: true, vendor: "hubspot", method: "HubSpotConversations.widget.open" };
    }
  } catch {}

  // Olark
  try {
    if (typeof window.olark === "function") {
      window.olark("api.box.expand");
      return { ok: true, vendor: "olark", method: "olark.api.box.expand" };
    }
  } catch {}

  return { ok: false };
})();
