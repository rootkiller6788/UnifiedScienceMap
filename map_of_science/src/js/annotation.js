import * as points from "./points";
import * as zoom from "./zoom";

function enableAnnotation(dataPoint) {
  const annotation = document.createElement("div");

  annotation.id = "annotation";
  annotation.classList.add(
    "animate__animated",
    "animate__fadeIn",
    "animate__faster",
  );
  annotation.innerHTML = points.buildDataPointDetails(dataPoint);

  const x = zoom.xScale(dataPoint.x);
  const y = zoom.yScale(dataPoint.y);
  annotation.style.top = y + "px";
  annotation.style.left = x + "px";

  document.getElementById("chart").appendChild(annotation);
}

function disableAnnotation() {
  const annotation = document.getElementById("annotation");

  if (!annotation) {
    return;
  }

  annotation.remove();
}

export function updateAnnotation(dataPoint) {
  if (dataPoint == null) {
    disableAnnotation();
  } else {
    enableAnnotation(dataPoint);
  }
}
