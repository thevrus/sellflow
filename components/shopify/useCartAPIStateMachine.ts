import { useMachine } from "@xstate/react/fsm";
import { flattenConnection } from "@shopify/hydrogen-react";
import {
  Cart,
  CartMachineActionEvent,
  CartMachineActions,
  CartMachineContext,
  CartMachineEvent,
  CartMachineFetchResultEvent,
  CartMachineTypeState,
} from "@shopify/hydrogen-react/dist/types/cart-types";
import {
  CountryCode,
  LanguageCode,
  Cart as CartType,
} from "@shopify/hydrogen-react/storefront-api-types";
import { assign, createMachine } from "@xstate/fsm";
import { InitEvent, StateMachine } from "@xstate/fsm/lib/types";
import { useMemo } from "react";
import { PartialDeep } from "type-fest";
import { useCartActions } from "./useCartActions";

function invokeCart(
  action: keyof CartMachineActions,
  options?: {
    entryActions?: [keyof CartMachineActions];
    resolveTarget?: CartMachineTypeState["value"];
    errorTarget?: CartMachineTypeState["value"];
    exitActions?: [keyof CartMachineActions];
  },
): StateMachine.Config<CartMachineContext, CartMachineEvent>["states"]["on"] {
  return {
    entry: [
      ...(options?.entryActions || []),
      assign({
        lastValidCart: (context) => context?.cart,
      }),
      "onCartActionEntry",
      "onCartActionOptimisticUI",
      action,
    ],
    on: {
      RESOLVE: {
        target: options?.resolveTarget || "idle",
        actions: [
          assign({
            prevCart: (context) => context?.lastValidCart,
            cart: (_, event) => event?.payload?.cart,
            rawCartResult: (_, event) => event?.payload?.rawCartResult,
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            errors: (_) => undefined,
          }),
        ],
      },
      ERROR: {
        target: options?.errorTarget || "error",
        actions: [
          assign({
            prevCart: (context) => context?.lastValidCart,
            cart: (context) => context?.lastValidCart,
            errors: (_, event) => event?.payload?.errors,
          }),
        ],
      },
      CART_COMPLETED: {
        target: "cartCompleted",
        actions: assign({
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          prevCart: (_) => undefined,
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          cart: (_) => undefined,
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          lastValidCart: (_) => undefined,
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          rawCartResult: (_) => undefined,
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          errors: (_) => undefined,
        }),
      },
    },
    exit: ["onCartActionComplete", ...(options?.exitActions || [])],
  };
}

const INITIALIZING_CART_EVENTS: StateMachine.Machine<
  CartMachineContext,
  CartMachineEvent,
  CartMachineTypeState
>["config"]["states"]["uninitialized"]["on"] = {
  CART_FETCH: {
    target: "cartFetching",
  },
  CART_CREATE: {
    target: "cartCreating",
  },
  CART_SET: {
    target: "idle",
    actions: [
      assign({
        rawCartResult: (_, event) => event.payload.cart,
        cart: (_, event) => cartFromGraphQL(event.payload.cart),
      }),
    ],
  },
};

const UPDATING_CART_EVENTS: StateMachine.Machine<
  CartMachineContext,
  CartMachineEvent,
  CartMachineTypeState
>["config"]["states"]["idle"]["on"] = {
  CARTLINE_ADD: {
    target: "cartLineAdding",
  },
  CARTLINE_UPDATE: {
    target: "cartLineUpdating",
  },
  CARTLINE_REMOVE: {
    target: "cartLineRemoving",
  },
  NOTE_UPDATE: {
    target: "noteUpdating",
  },
  BUYER_IDENTITY_UPDATE: {
    target: "buyerIdentityUpdating",
  },
  CART_ATTRIBUTES_UPDATE: {
    target: "cartAttributesUpdating",
  },
  DISCOUNT_CODES_UPDATE: {
    target: "discountCodesUpdating",
  },
};

function createCartMachine(
  initialCart?: PartialDeep<CartType, { recurseIntoArrays: true }>,
) {
  return createMachine<
    CartMachineContext,
    CartMachineEvent,
    CartMachineTypeState
  >({
    id: "Cart",
    initial: initialCart ? "idle" : "uninitialized",
    context: {
      cart: initialCart && cartFromGraphQL(initialCart),
    },
    states: {
      uninitialized: {
        on: INITIALIZING_CART_EVENTS,
      },
      cartCompleted: {
        on: INITIALIZING_CART_EVENTS,
      },
      initializationError: {
        on: INITIALIZING_CART_EVENTS,
      },
      idle: {
        on: { ...INITIALIZING_CART_EVENTS, ...UPDATING_CART_EVENTS },
      },
      error: {
        on: { ...INITIALIZING_CART_EVENTS, ...UPDATING_CART_EVENTS },
      },
      cartFetching: invokeCart("cartFetchAction", {
        errorTarget: "initializationError",
      }),
      cartCreating: invokeCart("cartCreateAction", {
        errorTarget: "initializationError",
      }),
      cartLineRemoving: invokeCart("cartLineRemoveAction"),
      cartLineUpdating: invokeCart("cartLineUpdateAction"),
      cartLineAdding: invokeCart("cartLineAddAction"),
      noteUpdating: invokeCart("noteUpdateAction"),
      buyerIdentityUpdating: invokeCart("buyerIdentityUpdateAction"),
      cartAttributesUpdating: invokeCart("cartAttributesUpdateAction"),
      discountCodesUpdating: invokeCart("discountCodesUpdateAction"),
    },
  });
}

export function useCartAPIStateMachine({
  numCartLines,
  onCartActionEntry,
  onCartActionOptimisticUI,
  onCartActionComplete,
  data: cart,
  cartFragment,
  countryCode,
  languageCode,
}: {
  /**  Maximum number of cart lines to fetch. Defaults to 250 cart lines. */
  numCartLines?: number;
  /** A callback that is invoked just before a Cart API action executes. */
  onCartActionEntry?: (
    context: CartMachineContext,
    event: CartMachineActionEvent,
  ) => void;
  /** A callback that is invoked after executing the entry actions for optimistic UI changes.  */
  onCartActionOptimisticUI?: (
    context: CartMachineContext,
    event: CartMachineEvent,
  ) => Partial<CartMachineContext>;
  /** A callback that is invoked after a Cart API completes. */
  onCartActionComplete?: (
    context: CartMachineContext,
    event: CartMachineFetchResultEvent,
  ) => void;
  /** An object with fields that correspond to the Storefront API's [Cart object](https://shopify.dev/api/storefront/2025-01/objects/cart). */
  data?: PartialDeep<CartMachineTypeState, { recurseIntoArrays: true }>;
  /** A fragment used to query the Storefront API's [Cart object](https://shopify.dev/api/storefront/2025-01/objects/cart) for all queries and mutations. A default value is used if no argument is provided. */
  cartFragment: string;
  /** The ISO country code for i18n. */
  countryCode?: CountryCode;
  /** The ISO language code for i18n. */
  languageCode?: LanguageCode;
}) {
  const {
    cartFetch,
    cartCreate,
    cartLineAdd,
    cartLineUpdate,
    cartLineRemove,
    noteUpdate,
    buyerIdentityUpdate,
    cartAttributesUpdate,
    discountCodesUpdate,
  } = useCartActions({
    numCartLines,
    cartFragment,
    countryCode,
    languageCode,
  });

  //@ts-ignore
  const cartMachine = useMemo(() => createCartMachine(cart), [cart]);

  const [state, send, service] = useMachine(cartMachine, {
    actions: {
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      cartFetchAction: async (_, event) => {
        if (event.type !== "CART_FETCH") return;

        const { data, errors } = await cartFetch(event?.payload?.cartId);
        const resultEvent = eventFromFetchResult(event, data?.cart, errors);
        send(resultEvent);
      },
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      cartCreateAction: async (_, event) => {
        if (event.type !== "CART_CREATE") return;

        const { data, errors } = await cartCreate(event?.payload);
        const resultEvent = eventFromFetchResult(
          event,
          data?.cartCreate?.cart,
          errors,
        );
        send(resultEvent);
      },
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      cartLineAddAction: async (context, event) => {
        if (event.type !== "CARTLINE_ADD" || !context?.cart?.id) return;

        const { data, errors } = await cartLineAdd(
          context.cart.id,
          event.payload.lines,
        );

        const resultEvent = eventFromFetchResult(
          event,
          data?.cartLinesAdd?.cart,
          errors,
        );

        send(resultEvent);
      },
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      cartLineUpdateAction: async (context, event) => {
        if (event.type !== "CARTLINE_UPDATE" || !context?.cart?.id) return;
        const { data, errors } = await cartLineUpdate(
          context.cart.id,
          event.payload.lines,
        );

        const resultEvent = eventFromFetchResult(
          event,
          data?.cartLinesUpdate?.cart,
          errors,
        );

        send(resultEvent);
      },
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      cartLineRemoveAction: async (context, event) => {
        if (event.type !== "CARTLINE_REMOVE" || !context?.cart?.id) return;
        const { data, errors } = await cartLineRemove(
          context.cart.id,
          event.payload.lines,
        );

        const resultEvent = eventFromFetchResult(
          event,
          data?.cartLinesRemove?.cart,
          errors,
        );

        send(resultEvent);
      },
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      noteUpdateAction: async (context, event) => {
        if (event.type !== "NOTE_UPDATE" || !context?.cart?.id) return;
        const { data, errors } = await noteUpdate(
          context.cart.id,
          event.payload.note,
        );

        const resultEvent = eventFromFetchResult(
          event,
          data?.cartNoteUpdate?.cart,
          errors,
        );

        send(resultEvent);
      },
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      buyerIdentityUpdateAction: async (context, event) => {
        if (event.type !== "BUYER_IDENTITY_UPDATE" || !context?.cart?.id)
          return;
        const { data, errors } = await buyerIdentityUpdate(
          context.cart.id,
          event.payload.buyerIdentity,
        );

        const resultEvent = eventFromFetchResult(
          event,
          data?.cartBuyerIdentityUpdate?.cart,
          errors,
        );

        send(resultEvent);
      },
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      cartAttributesUpdateAction: async (context, event) => {
        if (event.type !== "CART_ATTRIBUTES_UPDATE" || !context?.cart?.id)
          return;
        const { data, errors } = await cartAttributesUpdate(
          context.cart.id,
          event.payload.attributes,
        );

        const resultEvent = eventFromFetchResult(
          event,
          data?.cartAttributesUpdate?.cart,
          errors,
        );

        send(resultEvent);
      },
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      discountCodesUpdateAction: async (context, event) => {
        if (event.type !== "DISCOUNT_CODES_UPDATE" || !context?.cart?.id)
          return;
        const { data, errors } = await discountCodesUpdate(
          context.cart.id,
          event.payload.discountCodes,
        );
        const resultEvent = eventFromFetchResult(
          event,
          data?.cartDiscountCodesUpdate?.cart,
          errors,
        );

        send(resultEvent);
      },
      ...(onCartActionEntry && {
        onCartActionEntry: (context, event): void => {
          if (isCartActionEvent(event)) {
            onCartActionEntry(context, event);
          }
        },
      }),
      ...(onCartActionOptimisticUI && {
        onCartActionOptimisticUI: assign((context, event) => {
          return onCartActionOptimisticUI(context, event);
        }),
      }),
      ...(onCartActionComplete && {
        onCartActionComplete: (context, event): void => {
          if (isCartFetchResultEvent(event)) {
            onCartActionComplete(context, event);
          }
        },
      }),
    } as CartMachineActions,
  });

  return useMemo(() => [state, send, service] as const, [state, send, service]);
}

export function cartFromGraphQL(
  cart: PartialDeep<CartType, { recurseIntoArrays: true }>,
): Cart {
  return {
    ...cart,
    lines: flattenConnection(cart?.lines),
    note: cart.note ?? undefined,
  };
}

function isCartActionEvent(
  event: CartMachineEvent | InitEvent,
): event is CartMachineActionEvent {
  return (
    event.type === "CART_CREATE" ||
    event.type === "CARTLINE_ADD" ||
    event.type === "CARTLINE_UPDATE" ||
    event.type === "CARTLINE_REMOVE" ||
    event.type === "NOTE_UPDATE" ||
    event.type === "BUYER_IDENTITY_UPDATE" ||
    event.type === "CART_ATTRIBUTES_UPDATE" ||
    event.type === "DISCOUNT_CODES_UPDATE"
  );
}

function eventFromFetchResult(
  cartActionEvent: CartMachineActionEvent,
  cart?: PartialDeep<CartType, { recurseIntoArrays: true }> | null,
  errors?: unknown,
): CartMachineFetchResultEvent {
  if (errors) {
    return { type: "ERROR", payload: { errors, cartActionEvent } };
  }

  if (!cart) {
    return {
      type: "CART_COMPLETED",
      payload: {
        cartActionEvent,
      },
    };
  }

  return {
    type: "RESOLVE",
    payload: {
      cart: cartFromGraphQL(cart),
      rawCartResult: cart,
      cartActionEvent,
    },
  };
}

function isCartFetchResultEvent(
  event: CartMachineEvent | InitEvent,
): event is CartMachineFetchResultEvent {
  return (
    event.type === "RESOLVE" ||
    event.type === "ERROR" ||
    event.type === "CART_COMPLETED"
  );
}
