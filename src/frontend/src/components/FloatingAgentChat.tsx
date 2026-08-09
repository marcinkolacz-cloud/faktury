import { useEffect, useRef, useState } from "react";

const WORKER_URL = "https://ai-agent-chat.marcinkolacz.workers.dev/ai-agent/chat";

const TOOLS = [
  {
    type: "function",
    function: {
      name: "update_task_status",
      description: "Zmienia status czynności w harmonogramie budowy projektu (Postęp budowy).",
      parameters: {
        type: "object",
        properties: {
          buildId: { type: "integer", description: "ID buildu (z kontekstu, np. 'id=0')" },
          taskId: { type: "integer", description: "ID zadania w tym buildzie" },
          status: { type: "string", enum: ["notStarted", "inProgress", "done"] },
        },
        required: ["buildId", "taskId", "status"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_order_production_estimate",
      description: "Zapisuje przewidywany czas produkcji/dostawy dla zamówienia.",
      parameters: {
        type: "object",
        properties: {
          orderId: { type: "integer" },
          estimate: { type: "string", description: "np. '6-8 tygodni'" },
        },
        required: ["orderId", "estimate"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_project_expenses",
      description:
        "Wyszukuje koszty/faktury przypisane do projektu (Rejestr Faktur). Nie ma dostępu do zamówień, kontraktów, KSeF ani panelu admina — tylko wydatki dodane do konkretnego projektu.",
      parameters: {
        type: "object",
        properties: {
          projectNameQuery: {
            type: "string",
            description: "Nazwa/kod projektu (np. 'BAS004') lub pusty string dla wszystkich projektów.",
          },
        },
        required: ["projectNameQuery"],
      },
    },
  },
  // --- Rejestr Faktur (moduł "invoices") — pełny dostęp do wydatków/faktur ---
  {
    type: "function",
    function: {
      name: "list_expenses",
      description: "Lista wszystkich wydatków/faktur (moduł Rejestr Faktur), wszystkie projekty.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "create_expense",
      description: "Dodaje nowy wydatek/fakturę do projektu.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "integer" },
          productService: { type: "string" },
          supplier: { type: "string" },
          serialNumber: { type: "string" },
          orderDate: { type: "string", description: "np. '15.03.2026'" },
          paidBy: { type: "string" },
          invoiceNumber: { type: "string" },
          pricePln: { type: "number", description: "Cena w PLN, pomiń jeśli nieznana" },
          priceNet: { type: "number", description: "Cena netto, pomiń jeśli nieznana" },
          note: { type: "string" },
        },
        required: ["projectId", "productService", "supplier", "orderDate", "paidBy", "invoiceNumber"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_expense",
      description: "Edytuje istniejący wydatek/fakturę (wszystkie pola, id wymagane).",
      parameters: {
        type: "object",
        properties: {
          id: { type: "integer" },
          projectId: { type: "integer" },
          productService: { type: "string" },
          supplier: { type: "string" },
          serialNumber: { type: "string" },
          orderDate: { type: "string" },
          paidBy: { type: "string" },
          invoiceNumber: { type: "string" },
          pricePln: { type: "number" },
          priceNet: { type: "number" },
          note: { type: "string" },
        },
        required: ["id", "projectId", "productService", "supplier", "orderDate", "paidBy", "invoiceNumber"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "toggle_expense_paid",
      description: "Przełącza status 'opłacone' dla wydatku.",
      parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "toggle_expense_has_invoice",
      description: "Przełącza czy wydatek ma dołączoną fakturę.",
      parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "toggle_expense_confirmed",
      description: "Przełącza status 'potwierdzone' dla wydatku.",
      parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "toggle_expense_ksef_sent",
      description: "Przełącza czy faktura została wysłana do KSeF.",
      parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "trash_expense",
      description: "Przenosi wydatek do kosza (odwracalne).",
      parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "restore_expense",
      description: "Przywraca wydatek z kosza.",
      parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "list_trashed_expenses",
      description: "Lista wydatków znajdujących się w koszu.",
      parameters: { type: "object", properties: {} },
    },
  },
  // --- Zamówienia (moduł "orders") ---
  {
    type: "function",
    function: {
      name: "list_orders",
      description: "Lista wszystkich aktywnych zamówień.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "create_order",
      description: "Tworzy nowe zamówienie (status startowy: pending/w toku).",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "np. '15.03.2026'" },
          name: { type: "string" },
          quantity: { type: "number" },
          supplierName: { type: "string" },
          totalAmount: { type: "number" },
          advanceAmount: { type: "number", description: "Zaliczka, 0 jeśli brak" },
          currency: { type: "string", description: "np. PLN, EUR, USD" },
          note: { type: "string" },
          createdBy: { type: "string" },
        },
        required: ["date", "name", "quantity", "supplierName", "totalAmount", "advanceAmount", "currency", "createdBy"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_order",
      description: "Edytuje istniejące zamówienie (wszystkie pola poza statusem).",
      parameters: {
        type: "object",
        properties: {
          id: { type: "integer" },
          date: { type: "string" },
          name: { type: "string" },
          quantity: { type: "number" },
          supplierName: { type: "string" },
          totalAmount: { type: "number" },
          advanceAmount: { type: "number" },
          currency: { type: "string" },
          note: { type: "string" },
        },
        required: ["id", "date", "name", "quantity", "supplierName", "totalAmount", "advanceAmount", "currency"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_order_status",
      description: "Zmienia status zamówienia.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "integer" },
          status: { type: "string", enum: ["pending", "completed", "cancelled"] },
        },
        required: ["id", "status"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "trash_order",
      description: "Przenosi zamówienie do kosza (odwracalne).",
      parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "restore_order",
      description: "Przywraca zamówienie z kosza.",
      parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "list_trashed_orders",
      description: "Lista zamówień w koszu.",
      parameters: { type: "object", properties: {} },
    },
  },
  // --- Projekty (moduł "projects") ---
  {
    type: "function",
    function: {
      name: "list_projects",
      description: "Lista wszystkich aktywnych projektów (id + nazwa).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "create_project",
      description: "Tworzy nowy projekt (np. 'BAS006').",
      parameters: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "trash_project",
      description: "Przenosi projekt do kosza (odwracalne).",
      parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "restore_project",
      description: "Przywraca projekt z kosza.",
      parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "list_trashed_projects",
      description: "Lista projektów w koszu.",
      parameters: { type: "object", properties: {} },
    },
  },
  // --- Kalendarz (moduł "calendar") ---
  {
    type: "function",
    function: {
      name: "list_calendar_events",
      description: "Lista wszystkich aktywnych wydarzeń/zadań w kalendarzu.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "create_calendar_event",
      description: "Tworzy nowe wydarzenie/zadanie/ważną datę w kalendarzu.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          startDate: { type: "string", description: "format YYYY-MM-DD" },
          endDate: { type: "string", description: "format YYYY-MM-DD, może być takie samo jak startDate" },
          eventType: { type: "string", enum: ["meeting", "trip", "importantDate", "task"] },
          createdBy: { type: "string" },
        },
        required: ["title", "startDate", "endDate", "eventType", "createdBy"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "toggle_calendar_event_done",
      description: "Przełącza status 'zrobione' dla wydarzenia/zadania.",
      parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "trash_calendar_event",
      description: "Przenosi wydarzenie do kosza (odwracalne).",
      parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "restore_calendar_event",
      description: "Przywraca wydarzenie z kosza.",
      parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "list_trashed_calendar_events",
      description: "Lista wydarzeń w koszu.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "create_calendar_note",
      description: "Dodaje notatkę do wydarzenia w kalendarzu.",
      parameters: {
        type: "object",
        properties: {
          eventId: { type: "integer" },
          title: { type: "string" },
          content: { type: "string" },
        },
        required: ["eventId", "title", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_calendar_notes",
      description: "Lista notatek przypisanych do wydarzenia w kalendarzu.",
      parameters: { type: "object", properties: { eventId: { type: "integer" } }, required: ["eventId"] },
    },
  },
  // --- Magazyn (moduł "warehouse") ---
  {
    type: "function",
    function: {
      name: "list_warehouse_items",
      description: "Lista wszystkich pozycji magazynowych (nazwa, kategoria, stan, itp.).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_warehouse_categories",
      description: "Lista istniejących kategorii magazynowych.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "create_warehouse_item",
      description: "Dodaje nową pozycję do magazynu (stan startowy 0, użyj record_stock_movement żeby dodać ilość).",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          partDescription: { type: "string" },
          model: { type: "string" },
          link: { type: "string" },
          manufacturer: { type: "string" },
          serialNo: { type: "string" },
          category: { type: "string" },
          isReplacementPart: { type: "boolean" },
          appliesFnpt2: { type: "boolean" },
          appliesTrainer: { type: "boolean" },
          location: { type: "string" },
          note: { type: "string" },
        },
        required: ["name", "category"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_warehouse_item",
      description: "Edytuje istniejącą pozycję magazynową (nie zmienia stanu ilościowego).",
      parameters: {
        type: "object",
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
          partDescription: { type: "string" },
          model: { type: "string" },
          link: { type: "string" },
          manufacturer: { type: "string" },
          serialNo: { type: "string" },
          category: { type: "string" },
          isReplacementPart: { type: "boolean" },
          appliesFnpt2: { type: "boolean" },
          appliesTrainer: { type: "boolean" },
          location: { type: "string" },
          note: { type: "string" },
        },
        required: ["id", "name", "category"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "trash_warehouse_item",
      description: "Przenosi pozycję magazynową do kosza (odwracalne).",
      parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "restore_warehouse_item",
      description: "Przywraca pozycję magazynową z kosza.",
      parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "list_trashed_warehouse_items",
      description: "Lista pozycji magazynowych w koszu.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "record_stock_movement",
      description: "Rejestruje przyjęcie lub wydanie towaru z magazynu (aktualizuje stan ilościowy).",
      parameters: {
        type: "object",
        properties: {
          itemId: { type: "integer" },
          movementType: { type: "string", enum: ["in_", "out_"], description: "in_ = przyjęcie, out_ = wydanie" },
          quantity: { type: "number" },
          projectId: { type: "integer", description: "Pomiń jeśli ruch nie dotyczy konkretnego projektu" },
          performedBy: { type: "string" },
          date: { type: "string" },
          note: { type: "string" },
        },
        required: ["itemId", "movementType", "quantity", "performedBy", "date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_stock_movements",
      description: "Lista wszystkich ruchów magazynowych (historia przyjęć/wydań).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "trash_stock_movement",
      description: "Przenosi ruch magazynowy do kosza (odwracalne, cofa też wpływ na stan ilościowy).",
      parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "restore_stock_movement",
      description: "Przywraca ruch magazynowy z kosza.",
      parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "list_trashed_stock_movements",
      description: "Lista ruchów magazynowych w koszu.",
      parameters: { type: "object", properties: {} },
    },
  },
  // --- Zgłoszenia (moduł "tickets") ---
  {
    type: "function",
    function: {
      name: "list_tickets",
      description: "Lista wszystkich zgłoszeń (ticketów) klientów.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "update_ticket_status",
      description: "Zmienia status zgłoszenia.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "integer" },
          status: { type: "string", enum: ["open_", "inProgress", "waitingForClient", "closed"] },
        },
        required: ["id", "status"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_ticket_reply",
      description: "Dodaje odpowiedź do zgłoszenia (widoczną dla klienta lub tylko wewnętrzną notatkę).",
      parameters: {
        type: "object",
        properties: {
          id: { type: "integer" },
          author: { type: "string" },
          message: { type: "string" },
          isInternal: { type: "boolean", description: "true = notatka wewnętrzna, niewidoczna dla klienta" },
        },
        required: ["id", "author", "message", "isInternal"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "archive_ticket",
      description: "Archiwizuje zgłoszenie.",
      parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "unarchive_ticket",
      description: "Cofa archiwizację zgłoszenia.",
      parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "list_archived_ticket_ids",
      description: "Lista ID zarchiwizowanych zgłoszeń.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "mark_ticket_seen",
      description: "Oznacza zgłoszenie jako przejrzane (aktualny licznik odpowiedzi).",
      parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    },
  },
  // --- Umowy (moduł "contracts") ---
  {
    type: "function",
    function: {
      name: "list_contracts",
      description: "Lista wszystkich aktywnych umów.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "create_contract",
      description: "Tworzy nową umowę.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          category: { type: "string" },
          counterparty: { type: "string" },
          description: { type: "string" },
          endDate: { type: "string" },
          createdBy: { type: "string" },
        },
        required: ["title", "category", "counterparty", "endDate", "createdBy"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_contract",
      description: "Edytuje istniejącą umowę.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "integer" },
          title: { type: "string" },
          category: { type: "string" },
          counterparty: { type: "string" },
          description: { type: "string" },
          endDate: { type: "string" },
        },
        required: ["id", "title", "category", "counterparty", "endDate"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "trash_contract",
      description: "Przenosi umowę do kosza (odwracalne).",
      parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "restore_contract",
      description: "Przywraca umowę z kosza.",
      parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "list_trashed_contracts",
      description: "Lista umów w koszu.",
      parameters: { type: "object", properties: {} },
    },
  },
  // --- Urządzenia (moduł "devices") ---
  {
    type: "function",
    function: {
      name: "list_devices",
      description: "Lista wszystkich urządzeń klientów (rejestr sprzętu, gwarancje, wsparcie).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "add_device",
      description: "Dodaje nowe urządzenie do rejestru.",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "np. BAS001, TRA001" },
          name: { type: "string" },
          client: { type: "string" },
          location: { type: "string" },
          notes: { type: "string" },
          purchaseDate: { type: "string" },
          warrantyDate: { type: "string" },
          supportPackage: { type: "string" },
          contactPerson: { type: "string" },
          flightHours: { type: "integer" },
          flightMinutes: { type: "integer" },
        },
        required: ["symbol", "name", "client"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_device",
      description: "Edytuje istniejące urządzenie.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "integer" },
          symbol: { type: "string" },
          name: { type: "string" },
          client: { type: "string" },
          location: { type: "string" },
          notes: { type: "string" },
          purchaseDate: { type: "string" },
          warrantyDate: { type: "string" },
          supportPackage: { type: "string" },
          contactPerson: { type: "string" },
          flightHours: { type: "integer" },
          flightMinutes: { type: "integer" },
        },
        required: ["id", "symbol", "name", "client"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "trash_device",
      description: "Przenosi urządzenie do kosza (odwracalne).",
      parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "restore_device",
      description: "Przywraca urządzenie z kosza.",
      parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "add_device_service_entry",
      description: "Dodaje wpis do historii serwisowej urządzenia.",
      parameters: {
        type: "object",
        properties: {
          deviceId: { type: "integer" },
          date: { type: "string" },
          description: { type: "string" },
          performedBy: { type: "string" },
          flightHours: { type: "integer" },
          flightMinutes: { type: "integer" },
        },
        required: ["deviceId", "date", "description", "performedBy", "flightHours", "flightMinutes"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_device_service_entries",
      description: "Lista historii serwisowej dla urządzenia.",
      parameters: { type: "object", properties: { deviceId: { type: "integer" } }, required: ["deviceId"] },
    },
  },
  // --- KSeF (moduł "ksef") — WYŁĄCZNIE faktury już zaakceptowane przez admina.
  // Przegląd/akceptacja/odrzucanie nowych faktur KSeF zostaje tylko w panelu admina.
  {
    type: "function",
    function: {
      name: "list_shared_invoices",
      description: "Lista faktur KSeF zaakceptowanych przez admina i udostępnionych zespołowi.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_invoice_details",
      description: "Szczegóły (pozycje, link OneDrive) zaakceptowanej faktury KSeF.",
      parameters: { type: "object", properties: { ksefNumber: { type: "string" } }, required: ["ksefNumber"] },
    },
  },
  // --- Bartolini Drive (moduł "drive") — tylko odczyt, bez przesyłania plików przez czat ---
  {
    type: "function",
    function: {
      name: "list_drive_files",
      description: "Lista wszystkich plików w Bartolini Drive.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_drive_folders",
      description: "Lista wszystkich folderów w Bartolini Drive.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_drive_folder_contents",
      description: "Zawartość konkretnego folderu w Bartolini Drive (pomiń parentId dla folderu głównego).",
      parameters: { type: "object", properties: { parentId: { type: "integer" } } },
    },
  },
  // --- Powiadomienia (moduł "notifications") ---
  {
    type: "function",
    function: {
      name: "list_subscribers",
      description: "Lista subskrybentów powiadomień e-mail.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "add_subscriber",
      description: "Dodaje nowego subskrybenta powiadomień e-mail.",
      parameters: {
        type: "object",
        properties: {
          email: { type: "string" },
          name: { type: "string" },
          notifyUrgent: { type: "boolean" },
        },
        required: ["email", "name", "notifyUrgent"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_subscriber",
      description: "Edytuje istniejącego subskrybenta.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "integer" },
          email: { type: "string" },
          name: { type: "string" },
          notifyUrgent: { type: "boolean" },
        },
        required: ["id", "email", "name", "notifyUrgent"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_subscriber",
      description: "Usuwa subskrybenta (trwale).",
      parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    },
  },
];

type ChatMessage = { role: "user" | "assistant" | "system"; content: string };
type ApiMessage = { role: string; content: string; tool_calls?: any[]; tool_call_id?: string };

function statusToVariant(s: string) {
  return { [s]: null };
}

function opt(v: any): any[] {
  return v === undefined || v === null || v === "" ? [] : [v];
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function FloatingAgentChat({ actor }: { actor: any }) {
  const [open, setOpen] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [token, setToken] = useState("");
  const [systemContext, setSystemContext] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Lazy-connect: only mint a token / fetch context the first time the
  // person actually opens the widget, not on every page load.
  useEffect(() => {
    if (!open || initialized || !actor) return;
    setInitialized(true);
    (async () => {
      try {
        const [t, ctx] = await Promise.all([actor.requestAgentChatToken(), actor.getAgentContext()]);
        setToken(t);
        setSystemContext(ctx);
        setReady(true);
      } catch (e) {
        setError("Brak dostępu do czatu agenta (moduł 'Agent AI' może być odznaczony). " + errMsg(e));
      }
    })();
  }, [open, initialized, actor]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const callWorker = async (msgs: ApiMessage[]): Promise<any> => {
    const resp = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ messages: msgs, tools: TOOLS }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data?.error || "Błąd Workera");
    return data.message;
  };

  const executeTool = async (call: any): Promise<{ ok: boolean; note: string; data?: any }> => {
    const args = JSON.parse(call.function.arguments || "{}");
    try {
      if (call.function.name === "update_task_status") {
        await actor.updateProjectBuildTaskStatus(
          args.buildId,
          args.taskId,
          statusToVariant(args.status),
          args.status === "done" ? [new Date().toISOString().slice(0, 10)] : [],
        );
        return { ok: true, note: `Zaktualizowano status zadania #${args.taskId} → ${args.status}` };
      }
      if (call.function.name === "set_order_production_estimate") {
        await actor.setOrderProductionEstimate(args.orderId, args.estimate);
        return { ok: true, note: `Zapisano czas produkcji dla zamówienia #${args.orderId}: ${args.estimate}` };
      }
      if (call.function.name === "search_project_expenses") {
        const rows = await actor.searchProjectExpenses(args.projectNameQuery || "");
        return { ok: true, note: `Znaleziono ${rows.length} pozycji kosztowych.`, data: rows };
      }
      if (call.function.name === "list_expenses") {
        const rows = await actor.listMyExpenses();
        return { ok: true, note: `Lista wydatków: ${rows.length} pozycji.`, data: rows };
      }
      if (call.function.name === "create_expense") {
        const newId = await actor.createExpense(
          args.projectId,
          args.productService,
          args.supplier,
          args.serialNumber || "",
          [], // quantity
          [], // priceEur
          [], // priceUsd
          opt(args.pricePln),
          opt(args.priceNet),
          args.orderDate,
          args.paidBy,
          args.invoiceNumber,
          "", // ksefNote
          args.note || "",
        );
        return { ok: true, note: `Dodano wydatek #${newId}.` };
      }
      if (call.function.name === "update_expense") {
        const success = await actor.updateExpense(
          args.id,
          args.projectId,
          args.productService,
          args.supplier,
          args.serialNumber || "",
          [], // quantity
          [], // priceEur
          [], // priceUsd
          opt(args.pricePln),
          opt(args.priceNet),
          args.orderDate,
          args.paidBy,
          args.invoiceNumber,
          "", // ksefNote
          args.note || "",
        );
        return { ok: success, note: success ? `Zaktualizowano wydatek #${args.id}.` : `Nie znaleziono wydatku #${args.id}.` };
      }
      if (call.function.name === "toggle_expense_paid") {
        await actor.togglePaid(args.id);
        return { ok: true, note: `Przełączono status opłacenia dla wydatku #${args.id}.` };
      }
      if (call.function.name === "toggle_expense_has_invoice") {
        await actor.toggleHasInvoice(args.id);
        return { ok: true, note: `Przełączono status faktury dla wydatku #${args.id}.` };
      }
      if (call.function.name === "toggle_expense_confirmed") {
        await actor.toggleConfirmed(args.id);
        return { ok: true, note: `Przełączono status potwierdzenia dla wydatku #${args.id}.` };
      }
      if (call.function.name === "toggle_expense_ksef_sent") {
        await actor.toggleKsefSent(args.id);
        return { ok: true, note: `Przełączono status KSeF dla wydatku #${args.id}.` };
      }
      if (call.function.name === "trash_expense") {
        const success = await actor.trashExpense(args.id);
        return { ok: success, note: success ? `Przeniesiono wydatek #${args.id} do kosza.` : `Nie znaleziono wydatku #${args.id}.` };
      }
      if (call.function.name === "restore_expense") {
        const success = await actor.restoreExpense(args.id);
        return { ok: success, note: success ? `Przywrócono wydatek #${args.id} z kosza.` : `Wydatek #${args.id} nie był w koszu.` };
      }
      if (call.function.name === "list_trashed_expenses") {
        const rows = await actor.listTrashedExpenses();
        return { ok: true, note: `Kosz: ${rows.length} pozycji.`, data: rows };
      }
      if (call.function.name === "list_orders") {
        const rows = await actor.listOrders();
        return { ok: true, note: `Lista zamówień: ${rows.length} pozycji.`, data: rows };
      }
      if (call.function.name === "create_order") {
        const newId = await actor.createOrder(
          args.date,
          args.name,
          args.quantity,
          args.supplierName,
          args.totalAmount,
          args.advanceAmount,
          args.currency,
          args.note || "",
          args.createdBy,
        );
        return { ok: true, note: `Utworzono zamówienie #${newId}.` };
      }
      if (call.function.name === "update_order") {
        const success = await actor.updateOrder(
          args.id,
          args.date,
          args.name,
          args.quantity,
          args.supplierName,
          args.totalAmount,
          args.advanceAmount,
          args.currency,
          args.note || "",
        );
        return { ok: success, note: success ? `Zaktualizowano zamówienie #${args.id}.` : `Nie znaleziono zamówienia #${args.id}.` };
      }
      if (call.function.name === "update_order_status") {
        const success = await actor.updateOrderStatus(args.id, statusToVariant(args.status));
        return { ok: success, note: success ? `Zmieniono status zamówienia #${args.id} → ${args.status}.` : `Nie znaleziono zamówienia #${args.id}.` };
      }
      if (call.function.name === "trash_order") {
        const success = await actor.trashOrder(args.id);
        return { ok: success, note: success ? `Przeniesiono zamówienie #${args.id} do kosza.` : `Nie znaleziono zamówienia #${args.id}.` };
      }
      if (call.function.name === "restore_order") {
        const success = await actor.restoreOrder(args.id);
        return { ok: success, note: success ? `Przywrócono zamówienie #${args.id} z kosza.` : `Zamówienie #${args.id} nie było w koszu.` };
      }
      if (call.function.name === "list_trashed_orders") {
        const rows = await actor.listTrashedOrders();
        return { ok: true, note: `Kosz zamówień: ${rows.length} pozycji.`, data: rows };
      }
      if (call.function.name === "list_projects") {
        const rows = await actor.listMyProjects();
        return { ok: true, note: `Lista projektów: ${rows.length} pozycji.`, data: rows };
      }
      if (call.function.name === "create_project") {
        const newId = await actor.createProject(args.name);
        return { ok: true, note: `Utworzono projekt #${newId} (${args.name}).` };
      }
      if (call.function.name === "trash_project") {
        const success = await actor.trashProject(args.id);
        return { ok: success, note: success ? `Przeniesiono projekt #${args.id} do kosza.` : `Nie znaleziono projektu #${args.id}.` };
      }
      if (call.function.name === "restore_project") {
        const success = await actor.restoreProject(args.id);
        return { ok: success, note: success ? `Przywrócono projekt #${args.id} z kosza.` : `Projekt #${args.id} nie był w koszu.` };
      }
      if (call.function.name === "list_trashed_projects") {
        const rows = await actor.listTrashedProjects();
        return { ok: true, note: `Kosz projektów: ${rows.length} pozycji.`, data: rows };
      }
      if (call.function.name === "list_calendar_events") {
        const rows = await actor.listCalendarEvents();
        return { ok: true, note: `Lista wydarzeń: ${rows.length} pozycji.`, data: rows };
      }
      if (call.function.name === "create_calendar_event") {
        const newId = await actor.createCalendarEvent(
          args.title,
          args.description || "",
          args.startDate,
          args.endDate,
          statusToVariant(args.eventType),
          args.createdBy,
        );
        return { ok: true, note: `Utworzono wydarzenie #${newId} (${args.title}).` };
      }
      if (call.function.name === "toggle_calendar_event_done") {
        const success = await actor.toggleCalendarEventDone(args.id);
        return { ok: success, note: success ? `Przełączono status wydarzenia #${args.id}.` : `Nie znaleziono wydarzenia #${args.id}.` };
      }
      if (call.function.name === "trash_calendar_event") {
        const success = await actor.trashCalendarEvent(args.id);
        return { ok: success, note: success ? `Przeniesiono wydarzenie #${args.id} do kosza.` : `Nie znaleziono wydarzenia #${args.id}.` };
      }
      if (call.function.name === "restore_calendar_event") {
        const success = await actor.restoreCalendarEvent(args.id);
        return { ok: success, note: success ? `Przywrócono wydarzenie #${args.id} z kosza.` : `Wydarzenie #${args.id} nie było w koszu.` };
      }
      if (call.function.name === "list_trashed_calendar_events") {
        const rows = await actor.listTrashedCalendarEvents();
        return { ok: true, note: `Kosz wydarzeń: ${rows.length} pozycji.`, data: rows };
      }
      if (call.function.name === "create_calendar_note") {
        const newId = await actor.createCalendarNote(args.eventId, args.title, args.content);
        return { ok: true, note: `Dodano notatkę #${newId} do wydarzenia #${args.eventId}.` };
      }
      if (call.function.name === "list_calendar_notes") {
        const rows = await actor.listCalendarNotes(args.eventId);
        return { ok: true, note: `Notatki dla wydarzenia #${args.eventId}: ${rows.length}.`, data: rows };
      }
      if (call.function.name === "list_warehouse_items") {
        const rows = await actor.listWarehouseItems();
        return { ok: true, note: `Lista magazynowa: ${rows.length} pozycji.`, data: rows };
      }
      if (call.function.name === "list_warehouse_categories") {
        const rows = await actor.listWarehouseCategories();
        return { ok: true, note: `Kategorie: ${rows.length}.`, data: rows };
      }
      if (call.function.name === "create_warehouse_item") {
        const newId = await actor.createWarehouseItem(
          args.name,
          args.partDescription || "",
          args.model || "",
          args.link || "",
          args.manufacturer || "",
          args.serialNo || "",
          args.category,
          !!args.isReplacementPart,
          !!args.appliesFnpt2,
          !!args.appliesTrainer,
          args.location || "",
          args.note || "",
        );
        return { ok: true, note: `Dodano pozycję magazynową #${newId} (${args.name}).` };
      }
      if (call.function.name === "update_warehouse_item") {
        const success = await actor.updateWarehouseItem(
          args.id,
          args.name,
          args.partDescription || "",
          args.model || "",
          args.link || "",
          args.manufacturer || "",
          args.serialNo || "",
          args.category,
          !!args.isReplacementPart,
          !!args.appliesFnpt2,
          !!args.appliesTrainer,
          args.location || "",
          args.note || "",
        );
        return { ok: success, note: success ? `Zaktualizowano pozycję #${args.id}.` : `Nie znaleziono pozycji #${args.id}.` };
      }
      if (call.function.name === "trash_warehouse_item") {
        const success = await actor.trashWarehouseItem(args.id);
        return { ok: success, note: success ? `Przeniesiono pozycję #${args.id} do kosza.` : `Nie znaleziono pozycji #${args.id}.` };
      }
      if (call.function.name === "restore_warehouse_item") {
        const success = await actor.restoreWarehouseItem(args.id);
        return { ok: success, note: success ? `Przywrócono pozycję #${args.id} z kosza.` : `Pozycja #${args.id} nie była w koszu.` };
      }
      if (call.function.name === "list_trashed_warehouse_items") {
        const rows = await actor.listTrashedWarehouseItems();
        return { ok: true, note: `Kosz magazynu: ${rows.length} pozycji.`, data: rows };
      }
      if (call.function.name === "record_stock_movement") {
        await actor.recordStockMovement(
          args.itemId,
          statusToVariant(args.movementType),
          args.quantity,
          opt(args.projectId),
          args.performedBy,
          args.date,
          args.note || "",
        );
        return { ok: true, note: `Zarejestrowano ruch magazynowy dla pozycji #${args.itemId}.` };
      }
      if (call.function.name === "list_stock_movements") {
        const rows = await actor.listStockMovements();
        return { ok: true, note: `Historia ruchów: ${rows.length} pozycji.`, data: rows };
      }
      if (call.function.name === "trash_stock_movement") {
        const success = await actor.trashStockMovement(args.id);
        return { ok: success, note: success ? `Przeniesiono ruch #${args.id} do kosza.` : `Nie znaleziono ruchu #${args.id}.` };
      }
      if (call.function.name === "restore_stock_movement") {
        const success = await actor.restoreStockMovement(args.id);
        return { ok: success, note: success ? `Przywrócono ruch #${args.id} z kosza.` : `Ruch #${args.id} nie był w koszu.` };
      }
      if (call.function.name === "list_trashed_stock_movements") {
        const rows = await actor.listTrashedStockMovements();
        return { ok: true, note: `Kosz ruchów magazynowych: ${rows.length} pozycji.`, data: rows };
      }
      if (call.function.name === "list_tickets") {
        const rows = await actor.listTickets();
        return { ok: true, note: `Lista zgłoszeń: ${rows.length} pozycji.`, data: rows };
      }
      if (call.function.name === "update_ticket_status") {
        const success = await actor.updateTicketStatus(args.id, statusToVariant(args.status));
        return { ok: success, note: success ? `Zmieniono status zgłoszenia #${args.id} → ${args.status}.` : `Nie znaleziono zgłoszenia #${args.id}.` };
      }
      if (call.function.name === "add_ticket_reply") {
        const success = await actor.addTicketReply(args.id, args.author, args.message, !!args.isInternal);
        return { ok: success, note: success ? `Dodano odpowiedź do zgłoszenia #${args.id}.` : `Nie znaleziono zgłoszenia #${args.id}.` };
      }
      if (call.function.name === "archive_ticket") {
        const success = await actor.archiveTicket(args.id);
        return { ok: success, note: success ? `Zarchiwizowano zgłoszenie #${args.id}.` : `Nie znaleziono zgłoszenia #${args.id}.` };
      }
      if (call.function.name === "unarchive_ticket") {
        const success = await actor.unarchiveTicket(args.id);
        return { ok: success, note: success ? `Cofnięto archiwizację zgłoszenia #${args.id}.` : `Nie znaleziono zgłoszenia #${args.id}.` };
      }
      if (call.function.name === "list_archived_ticket_ids") {
        const rows = await actor.listArchivedTicketIds();
        return { ok: true, note: `Zarchiwizowane zgłoszenia: ${rows.length}.`, data: rows };
      }
      if (call.function.name === "mark_ticket_seen") {
        const success = await actor.markTicketSeen(args.id);
        return { ok: success, note: success ? `Oznaczono zgłoszenie #${args.id} jako przejrzane.` : `Nie znaleziono zgłoszenia #${args.id}.` };
      }
      if (call.function.name === "list_contracts") {
        const rows = await actor.listContracts();
        return { ok: true, note: `Lista umów: ${rows.length} pozycji.`, data: rows };
      }
      if (call.function.name === "create_contract") {
        const newId = await actor.createContract(args.title, args.category, args.counterparty, args.description || "", args.endDate, args.createdBy);
        return { ok: true, note: `Utworzono umowę #${newId} (${args.title}).` };
      }
      if (call.function.name === "update_contract") {
        const success = await actor.updateContract(args.id, args.title, args.category, args.counterparty, args.description || "", args.endDate);
        return { ok: success, note: success ? `Zaktualizowano umowę #${args.id}.` : `Nie znaleziono umowy #${args.id}.` };
      }
      if (call.function.name === "trash_contract") {
        const success = await actor.trashContract(args.id);
        return { ok: success, note: success ? `Przeniesiono umowę #${args.id} do kosza.` : `Nie znaleziono umowy #${args.id}.` };
      }
      if (call.function.name === "restore_contract") {
        const success = await actor.restoreContract(args.id);
        return { ok: success, note: success ? `Przywrócono umowę #${args.id} z kosza.` : `Umowa #${args.id} nie była w koszu.` };
      }
      if (call.function.name === "list_trashed_contracts") {
        const rows = await actor.listTrashedContracts();
        return { ok: true, note: `Kosz umów: ${rows.length} pozycji.`, data: rows };
      }
      if (call.function.name === "list_devices") {
        const rows = await actor.listDevices();
        return { ok: true, note: `Lista urządzeń: ${rows.length} pozycji.`, data: rows };
      }
      if (call.function.name === "add_device") {
        const newId = await actor.addDevice(
          args.symbol,
          args.name,
          args.client,
          args.location || "",
          args.notes || "",
          args.purchaseDate || "",
          args.warrantyDate || "",
          args.supportPackage || "",
          args.contactPerson || "",
          args.flightHours || 0,
          args.flightMinutes || 0,
        );
        return { ok: true, note: `Dodano urządzenie #${newId} (${args.symbol}).` };
      }
      if (call.function.name === "update_device") {
        const success = await actor.updateDevice(
          args.id,
          args.symbol,
          args.name,
          args.client,
          args.location || "",
          args.notes || "",
          args.purchaseDate || "",
          args.warrantyDate || "",
          args.supportPackage || "",
          args.contactPerson || "",
          args.flightHours || 0,
          args.flightMinutes || 0,
        );
        return { ok: success, note: success ? `Zaktualizowano urządzenie #${args.id}.` : `Nie znaleziono urządzenia #${args.id}.` };
      }
      if (call.function.name === "trash_device") {
        const success = await actor.trashDevice(args.id);
        return { ok: success, note: success ? `Przeniesiono urządzenie #${args.id} do kosza.` : `Nie znaleziono urządzenia #${args.id}.` };
      }
      if (call.function.name === "restore_device") {
        const success = await actor.restoreDevice(args.id);
        return { ok: success, note: success ? `Przywrócono urządzenie #${args.id} z kosza.` : `Urządzenie #${args.id} nie było w koszu.` };
      }
      if (call.function.name === "add_device_service_entry") {
        const newId = await actor.addDeviceServiceEntry(args.deviceId, args.date, args.description, args.performedBy, args.flightHours, args.flightMinutes);
        return { ok: true, note: `Dodano wpis serwisowy #${newId} do urządzenia #${args.deviceId}.` };
      }
      if (call.function.name === "list_device_service_entries") {
        const rows = await actor.listDeviceServiceEntries(args.deviceId);
        return { ok: true, note: `Historia serwisowa: ${rows.length} wpisów.`, data: rows };
      }
      if (call.function.name === "list_shared_invoices") {
        const rows = await actor.listSharedInvoices();
        return { ok: true, note: `Zaakceptowane faktury KSeF: ${rows.length}.`, data: rows };
      }
      if (call.function.name === "get_invoice_details") {
        const [lineItems, oneDriveLink] = await actor.getInvoiceDetails(args.ksefNumber);
        return { ok: true, note: `Szczegóły faktury ${args.ksefNumber} pobrane.`, data: { lineItems, oneDriveLink } };
      }
      if (call.function.name === "list_drive_files") {
        const rows = await actor.listFiles();
        return { ok: true, note: `Pliki w Bartolini Drive: ${rows.length}.`, data: rows };
      }
      if (call.function.name === "list_drive_folders") {
        const rows = await actor.listAllFolders();
        return { ok: true, note: `Foldery w Bartolini Drive: ${rows.length}.`, data: rows };
      }
      if (call.function.name === "list_drive_folder_contents") {
        const result = await actor.listFolderContents(opt(args.parentId));
        return { ok: true, note: `Zawartość folderu pobrana.`, data: result };
      }
      if (call.function.name === "list_subscribers") {
        const rows = await actor.listSubscribers();
        return { ok: true, note: `Subskrybenci powiadomień: ${rows.length}.`, data: rows };
      }
      if (call.function.name === "add_subscriber") {
        const newId = await actor.addSubscriber(args.email, args.name, !!args.notifyUrgent);
        return { ok: true, note: `Dodano subskrybenta #${newId} (${args.email}).` };
      }
      if (call.function.name === "update_subscriber") {
        const success = await actor.updateSubscriber(args.id, args.email, args.name, !!args.notifyUrgent);
        return { ok: success, note: success ? `Zaktualizowano subskrybenta #${args.id}.` : `Nie znaleziono subskrybenta #${args.id}.` };
      }
      if (call.function.name === "remove_subscriber") {
        const success = await actor.removeSubscriber(args.id);
        return { ok: success, note: success ? `Usunięto subskrybenta #${args.id}.` : `Nie znaleziono subskrybenta #${args.id}.` };
      }
      return { ok: false, note: "Nieznane narzędzie: " + call.function.name };
    } catch (e) {
      return { ok: false, note: "Błąd wykonania: " + errMsg(e) };
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    setError("");

    const userMsg: ChatMessage = { role: "user", content: text };
    const history = [...messages, userMsg];
    setMessages(history);

    try {
      const systemMsg: ApiMessage = {
        role: "system",
        content:
          "Jesteś asystentem AI dla Bartolini Air Simulation, pomagasz przy budowie symulatorów (BAS/TRA). " +
          "Masz narzędzia z dostępem do zapisu (dodawanie/edycja/kasowanie do kosza) w module Rejestr Faktur — " +
          "używaj ich swobodnie gdy user prosi o konkretną akcję, ale przy nieodwracalnych lub niejednoznacznych " +
          "operacjach zapytaj o potwierdzenie zanim wykonasz (usuwanie z kosza jest odwracalne przez restore_expense, więc trash_expense możesz wykonywać śmielej). " +
          "Trzymaj się instrukcji admina poniżej. Jeśli czegoś nie wiesz z kontekstu — pytaj, nie zmyślaj.\n\n" +
          systemContext,
      };
      const apiHistory: ApiMessage[] = [systemMsg, ...history.map((m) => ({ role: m.role, content: m.content }))];

      let assistantMsg = await callWorker(apiHistory);

      if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
        const toolResults: ApiMessage[] = [];
        for (const call of assistantMsg.tool_calls) {
          const result = await executeTool(call);
          toolResults.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
          setMessages((prev) => [...prev, { role: "system", content: "🔧 " + result.note }]);
        }
        const followUp: ApiMessage[] = [
          ...apiHistory,
          { role: "assistant", content: assistantMsg.content || "", tool_calls: assistantMsg.tool_calls },
          ...toolResults,
        ];
        assistantMsg = await callWorker(followUp);
      }

      setMessages((prev) => [...prev, { role: "assistant", content: assistantMsg.content || "" }]);
    } catch (e) {
      setError("Błąd czatu: " + errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg flex items-center justify-center text-2xl"
        title="Czat z Agentem AI"
      >
        💬
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 w-[380px] max-w-[calc(100vw-2rem)] bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg shadow-2xl flex flex-col h-[550px] max-h-[calc(100vh-3rem)]">
      <div className="p-3 border-b border-[var(--border-color-light)] flex items-center justify-between shrink-0">
        <h2 className="font-semibold text-[var(--text-primary)] text-sm">💬 Agent AI</h2>
        <button onClick={() => setOpen(false)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-lg leading-none px-1">
          ✕
        </button>
      </div>

      {error && !ready ? (
        <div className="p-4 text-sm text-red-500">{error}</div>
      ) : (
        <>
          <div ref={scrollRef} className="flex-1 overflow-auto p-3 space-y-2">
            {!ready && <div className="text-xs text-[var(--text-secondary)]">Łączenie z agentem…</div>}
            {messages.map((m, i) => {
              if (m.role === "system") {
                return (
                  <div key={i} className="text-xs text-emerald-700 bg-emerald-50 px-2 py-1 rounded inline-block">
                    {m.content}
                  </div>
                );
              }
              const isUser = m.role === "user";
              return (
                <div key={i} className={"flex " + (isUser ? "justify-end" : "justify-start")}>
                  <div
                    className={
                      "max-w-[80%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap " +
                      (isUser ? "bg-cyan-600 text-white" : "bg-[var(--bg-page)] text-[var(--text-primary)] border border-[var(--border-color-light)]")
                    }
                  >
                    {m.content}
                  </div>
                </div>
              );
            })}
            {busy && <div className="text-xs text-[var(--text-secondary)]">Agent pisze…</div>}
          </div>

          {error && <div className="px-3 text-xs text-red-500 shrink-0">{error}</div>}

          <div className="p-3 border-t border-[var(--border-color-light)] flex gap-2 shrink-0">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())}
              placeholder={ready ? "Napisz do agenta…" : "Łączenie…"}
              disabled={!ready || busy}
              className="flex-1 border border-[var(--border-color)] rounded px-3 py-2 text-sm disabled:opacity-50"
            />
            <button
              onClick={send}
              disabled={!ready || busy || !input.trim()}
              className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded text-sm font-medium"
            >
              Wyślij
            </button>
          </div>
        </>
      )}
    </div>
  );
}
