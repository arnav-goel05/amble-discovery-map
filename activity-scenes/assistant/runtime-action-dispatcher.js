const changed = (value = true) => ({
  changed: value !== false && value !== null,
});

export function createRuntimeActionDispatcher({
  map,
  initialCamera,
  featureTour,
  experienceIntro,
  eventController,
  restaurantController,
  planningController,
  locationController,
  locationLayers,
  transitLayers,
  discoveryAreaLayers,
  applicationControls: getApplicationControls,
} = {}) {
  const domainDispatch = (owner, actionId, args) =>
    typeof owner?.dispatch === "function"
      ? changed(owner.dispatch(actionId, args))
      : changed(false);

  return (actionId, args = {}) => {
    if (actionId === "map.zoomin") map.zoomIn({ duration: 300 });
    else if (actionId === "map.zoomout") map.zoomOut({ duration: 300 });
    else if (actionId === "map.pan") {
      const amount = 96 * (args.amount || 1);
      const offsets = {
        up: [0, amount],
        down: [0, -amount],
        left: [amount, 0],
        right: [-amount, 0],
      };
      map.panBy(offsets[args.direction], { duration: 300 });
    } else if (actionId === "map.rotate")
      map.easeTo({
        bearing: args.bearing ?? map.getBearing() + 45,
        duration: 450,
      });
    else if (actionId === "map.resetview")
      map.easeTo({ ...initialCamera, duration: 450 });
    else if (actionId === "map.setlayervisibility") {
      if (args.layer === "location") {
        locationLayers.setVisible(true);
        return changed(args.visible === true);
      }
      if (args.layer === "mrtStations" || args.layer === "mrtLines") {
        transitLayers.setVisible(true);
        return changed(args.visible === true);
      }
      discoveryAreaLayers.setVisible?.(args.visible);
    } else if (actionId === "map.focustarget") {
      const selected =
        eventController?.selectCandidate?.(args.targetId) ||
        restaurantController?.selectCandidate?.(args.targetId) ||
        planningController?.selectCandidate?.(args.targetId);
      return changed(Boolean(selected));
    } else if (actionId === "tour.start") featureTour.start({ force: true });
    else if (actionId === "tour.previous")
      return changed(featureTour.previous());
    else if (actionId === "tour.next") return changed(featureTour.next());
    else if (actionId === "tour.finish") featureTour.finish();
    else if (actionId.startsWith("event."))
      return domainDispatch(eventController, actionId, args);
    else if (actionId.startsWith("restaurant."))
      return domainDispatch(restaurantController, actionId, args);
    else if (actionId === "plan.addstop") {
      if (args.targetId?.startsWith("event:"))
        return domainDispatch(eventController, "event.addtoplan", {
          eventId: args.targetId,
        });
      if (args.targetId?.startsWith("restaurant:"))
        return domainDispatch(restaurantController, "restaurant.addtoplan", {
          restaurantId: args.targetId,
        });
      return changed(false);
    } else if (actionId.startsWith("plan."))
      return domainDispatch(planningController, actionId, args);
    else if (actionId === "navigation.enterexperience") {
      return changed(experienceIntro?.enter?.() === true);
    } else if (actionId === "navigation.openexternal") {
      if (args.targetId?.startsWith("event:"))
        return domainDispatch(
          eventController,
          args.linkKind === "directions"
            ? "event.opendirections"
            : "event.openreference",
          { eventId: args.targetId },
        );
      if (args.targetId?.startsWith("restaurant:"))
        return domainDispatch(
          restaurantController,
          args.linkKind === "directions"
            ? "restaurant.opendirections"
            : "restaurant.openreference",
          { restaurantId: args.targetId },
        );
      return changed(false);
    } else if (actionId === "plan.uselocation") {
      void locationController.requestLocation();
    } else if (actionId === "plan.focuslocation")
      return changed(locationLayers.focusLocation());
    else {
      const result = getApplicationControls()?.dispatch(actionId, args);
      return changed(result?.changed === true);
    }
    return changed(true);
  };
}
