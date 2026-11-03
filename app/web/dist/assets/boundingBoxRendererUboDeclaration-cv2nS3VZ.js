import{b6 as e}from"./index-Crtbj3yS.js";const o="boundingBoxRendererUboDeclaration",r=`#ifdef WEBGL2
uniform vec4 color;uniform mat4 world;uniform mat4 viewProjection;
#ifdef MULTIVIEW
uniform mat4 viewProjectionR;
#endif
#else
layout(std140,column_major) uniform;uniform BoundingBoxRenderer {vec4 color;mat4 world;mat4 viewProjection;mat4 viewProjectionR;};
#endif
`;e.IncludesShadersStore[o]||(e.IncludesShadersStore[o]=r);const i={name:o,shader:r};export{i as b};
