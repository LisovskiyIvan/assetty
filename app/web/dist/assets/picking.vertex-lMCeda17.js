import{b6 as e}from"./index-CramQklb.js";import{b as i,a as o,c as n,d as s}from"./bakedVertexAnimation-dEAuWn_y.js";import{m as c,a as d,b as l,c as m}from"./morphTargetsVertex-S2nbdi2M.js";import{i as p}from"./instancesDeclaration-RuHj5KSp.js";import{i as f}from"./instancesVertex-Z71VK4-E.js";const t="pickingVertexShader",r=`attribute vec3 position;
#if defined(INSTANCES)
attribute float instanceMeshID;
#endif
#include<bonesDeclaration>
#include<bakedVertexAnimationDeclaration>
#include<morphTargetsVertexGlobalDeclaration>
#include<morphTargetsVertexDeclaration>[0..maxSimultaneousMorphTargets]
#include<instancesDeclaration>
uniform mat4 viewProjection;
#if defined(INSTANCES)
flat varying float vMeshID;
#endif
void main(void) {vec3 positionUpdated=position;
#include<morphTargetsVertexGlobal>
#include<morphTargetsVertex>[0..maxSimultaneousMorphTargets]
#include<instancesVertex>
#include<bonesVertex>
#include<bakedVertexAnimation>
vec4 worldPos=finalWorld*vec4(positionUpdated,1.0);gl_Position=viewProjection*worldPos;
#if defined(INSTANCES)
vMeshID=instanceMeshID;
#endif
}
`;e.ShadersStore[t]||(e.ShadersStore[t]=r);const h=[i,o,c,d,p,l,m,f,n,s];for(const a of h)e.IncludesShadersStore[a.name]||(e.IncludesShadersStore[a.name]=a.shader);const g={name:t,shader:r};export{g as pickingVertexShader};
